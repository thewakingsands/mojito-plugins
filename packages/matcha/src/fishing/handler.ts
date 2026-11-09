// Ported from Cafe.Matcha (AGPL-3.0), FishingHandler.
import type { Json } from '@ffcafe/mojito-plugin-sdk'
import type { MatchaEmitter, MatchaPacket } from '../protocol.js'
import { type FishingAttributes, type FishingCapture, type FishingFrame, publicFrame } from './types.js'

const FISHING_EVENT = 0x00150001
const emptyCapture = (): FishingCapture => ({
  serverCastTime: null,
  hook: null,
  size: null,
  quantity: null,
  large: null,
  gatheringFailed: false,
  unsupported: false,
  terminal: false,
  patiencePrecision: null,
  patienceSuccess: null,
  slap: 0,
  identical: 0,
  hidden: 0,
  hiddenStack: 0,
  lure: 0,
  lureTarget: false,
  lureTimes: [],
})
export interface FishingHandlerOptions {
  emit: MatchaEmitter
  observe?: (frame: FishingFrame) => void
  attributes?: () => FishingAttributes | null
  now?: () => number
  id?: () => string
  actorId?: () => number | null
}
export class FishingHandler {
  private readonly statuses = new Set<number>()
  private readonly statusStacks = new Map<number, number>()
  private statusesKnown = false
  private actor = 0
  private bait: number | null = null
  private place: number | null = null
  private cast: FishingFrame | null = null
  private capture: FishingCapture | null = null
  private phase: string | null = null
  private pendingCommand: number | null = null
  private pendingTime = 0
  private slap = 0
  private identical = 0
  private swimBait = 0
  private taskBait = 0
  private taskActive = false
  constructor(private readonly options: FishingHandlerOptions) {}
  get snapshot(): FishingFrame | null {
    return structuredClone(this.cast)
  }
  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
  reset(time = this.now()): void {
    this.cast = this.capture = null
    this.phase = null
    this.actor = 0
    this.bait = this.place = this.pendingCommand = null
    this.slap = this.identical = this.swimBait = this.taskBait = 0
    this.taskActive = false
    this.statusesKnown = false
    this.statuses.clear()
    this.statusStacks.clear()
    this.emit('reset', time)
  }
  dispose(): void {
    this.reset()
  }
  handle(packet: MatchaPacket): boolean {
    if (packet.channel !== 'zone' || !packet.type) return false
    const bytes = packet.data,
      data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const u16 = (offset: number) => data.getUint16(offset, true)
    const u32 = (offset: number) => data.getUint32(offset, true)
    const time = packet.timestamp
    if (packet.direction === 'send') {
      if (packet.type !== 'ClientTrigger' || bytes.length < 12 || u32(0) !== 0x2bd) return false
      const command = u32(4)
      if ([0, 3, 15].includes(command)) {
        this.pendingCommand = command
        this.pendingTime = time
      }
      if (this.capture && this.cast) {
        const hook = new Map([
          [2, 1],
          [10, 2],
          [11, 3],
          [16, 4],
          [21, 5],
          [28, 6],
        ]).get(command)
        if (hook !== undefined) this.capture.hook = hook
        if (command === 22 || command === 23) this.capture.lureTarget = false
      }
      return true
    }
    if (packet.direction !== 'recv') return false
    if (packet.type === 'PlayerSetup' && bytes.length >= 0x30) {
      this.bait = u32(0x2c)
      this.emit('bait', time)
      return false
    }
    if (packet.type === 'InitZone' || packet.type === 'Logout') {
      if (packet.type === 'InitZone' && bytes.length !== 136) return false
      this.reset(time)
      return false
    }
    if (packet.type === 'ActorControlSelf') {
      if (bytes.length !== 40) return false
      const category = u16(0)
      if (category === 325) {
        if (!this.observeActor(packet.targetActor, time)) return false
        this.bait = u32(4)
        this.emit('bait', time)
        return true
      }
      if (packet.targetActor !== this.actor) return false
      if (category === 338) {
        const index = u32(4)
        this.swimBait = index < 3 ? u32(8 + index * 4) : 0
        return true
      }
      if (category === 3501) {
        this.taskBait = u32(4)
        return true
      }
      if (category === 517) return this.handleLog(u32(4), u32(8), time)
      if (category === 320 && this.cast && (this.phase === 'hook' || this.phase === 'reel')) {
        const packed = u32(8)
        this.catch(u32(4), packed >>> 16, packed & 255, (u32(12) & 16) !== 0, time)
        return true
      }
      return false
    }
    if (packet.type === 'StatusEffectList') {
      if (
        bytes.length < 380 ||
        packet.sourceActor !== packet.targetActor ||
        !this.observeActor(packet.targetActor, time)
      )
        return false
      const updated = new Set<number>()
      for (let offset = 20; offset < 380; offset += 12) {
        const status = u16(offset)
        if (status !== 0) {
          updated.add(status)
          this.observeStatus(status, u16(offset + 2), time)
        }
      }
      for (const missing of this.statuses)
        if (!updated.has(missing)) {
          this.statusStacks.delete(missing)
          this.statuses.delete(missing)
        }
      if (!updated.has(1803)) this.slap = 0
      if (!updated.has(1804)) this.identical = 0
      this.statusesKnown = true
      return true
    }
    if (packet.type === 'ActorControl') {
      if (bytes.length !== 24 || packet.sourceActor !== this.actor) return false
      const category = u16(0)
      if (category === 20) this.observeStatus(u32(4), u32(8), time)
      if (category === 21) {
        const lost = u32(4)
        this.statuses.delete(lost)
        this.statusStacks.delete(lost)
        if (lost === 1803) this.slap = 0
        if (lost === 1804) this.identical = 0
      }
      return false
    }
    if (packet.type === 'SystemLogMessage')
      return bytes.length === 24 && u32(0) === FISHING_EVENT ? this.handleLog(u32(4), u32(12), time) : false
    if (packet.type === 'FishCaught') {
      if (
        bytes.length !== 16 ||
        packet.targetActor !== this.actor ||
        !this.cast ||
        (this.phase !== 'reel' && this.phase !== 'hook')
      )
        return false
      this.catch(u32(0), u16(4), u16(6) & 255, (u32(12) & 16) !== 0, time)
      return true
    }
    if (packet.type !== 'EventPlay' && packet.type !== 'EventPlay4') return false
    if (bytes.length !== (packet.type === 'EventPlay' ? 40 : 48) || u32(8) !== FISHING_EVENT) return false
    if (u32(0) !== packet.targetActor || !this.observeActor(packet.targetActor, time)) return true
    if (this.capture) {
      const animation = u16(28)
      if ([4659, 4660, 4663, 4664, 4665, 4666, 12510, 12511, 12512, 12513, 12514, 12515].includes(animation)) {
        this.capture.patiencePrecision = [4660, 4665, 4666, 12511, 12514, 12515].includes(animation)
        this.capture.patienceSuccess = animation < 12510
      }
    }
    switch (u16(12)) {
      case 1: {
        if (this.cast?.castTime === time) return true
        const known = this.pendingCommand !== null && time >= this.pendingTime && time - this.pendingTime < 5000
        const mooch = known ? this.pendingCommand === 3 || this.pendingCommand === 15 : null
        if (this.bait === null) {
          const memory = this.options.attributes?.()
          if (memory && this.now() >= memory.sampledAt && this.now() - memory.sampledAt <= 2000)
            this.bait = memory.baitId
        }
        this.capture = {
          ...emptyCapture(),
          slap: this.slap,
          identical: this.identical,
          unsupported: !this.statusesKnown || this.statuses.has(3972) || this.statuses.has(3973),
        }
        this.cast = {
          action: 'cast',
          time,
          castId: this.options.id?.() ?? crypto.randomUUID(),
          castTime: time,
          biteTime: null,
          hookTime: null,
          baitId: mooch === false ? this.effectiveBait : null,
          baseBaitId: this.bait,
          placeId: null,
          tug: null,
          fishId: null,
          mooch,
          chum: this.statusesKnown ? this.statuses.has(763) : null,
          snagging: this.statusesKnown ? this.statuses.has(761) : null,
          statuses: this.statusesKnown ? [...this.statuses].sort((a, b) => a - b) : null,
          capture: this.capture,
        }
        this.pendingCommand = null
        this.phase = 'cast'
        this.emit('cast', time)
        break
      }
      case 5: {
        const tug = u16(28) - 292 + 1
        if (tug < 1 || tug > 3) return true
        if (!this.cast || this.phase === 'cast') this.options.emit('FishBite', { time, type: tug }, time)
        if (!this.cast || this.phase !== 'cast') return true
        this.cast.biteTime = time
        this.cast.tug = tug
        this.phase = 'bite'
        this.emit('bite', time)
        break
      }
      case 6:
        if (!this.cast || (this.phase !== 'cast' && this.phase !== 'bite')) return true
        this.cast.hookTime = time
        this.phase = 'hook'
        this.emit('hook', time)
        break
      case 2:
        if (!this.cast || this.phase === 'catch' || this.phase === 'end') return true
        this.phase = 'reel'
        this.emit('reel', time)
        break
      case 4:
        if (this.cast && this.phase !== 'catch' && this.phase !== 'end') {
          this.phase = 'end'
          if (this.capture) this.capture.terminal = true
          this.emit('end', time)
        }
        break
      case 3:
        this.emit('quit', time)
        this.cast = this.capture = null
        this.place = null
        this.phase = null
        break
    }
    return true
  }
  private get effectiveBait(): number | null {
    return this.swimBait !== 0 ? this.swimBait : this.taskActive ? this.taskBait || null : this.bait
  }
  private observeStatus(status: number, stacks: number, time: number): void {
    const changed = this.statusStacks.get(status) !== stacks
    this.statuses.add(status)
    this.statusStacks.set(status, stacks)
    if (!changed || !this.capture || this.phase !== 'cast' || (status !== 3972 && status !== 3973)) return
    if (stacks < 1 || stacks > 3) {
      this.capture.unsupported = true
      return
    }
    this.capture.lure = status === 3972 ? stacks : 8 - stacks
    this.capture.lureTimes.push(time)
  }
  private handleLog(message: number, parameter: number, time: number): boolean {
    if (message === 1110 || message === 1115) {
      this.place = parameter
      if (this.cast && this.capture && (this.phase === 'cast' || message === 1115)) {
        this.cast.placeId = this.place
        if (message === 1110) {
          this.cast.mooch = false
          this.cast.baitId = this.effectiveBait
          this.capture.serverCastTime = time
        }
        this.emit('place', time)
      }
    } else if (
      message === 1121 &&
      this.cast &&
      this.capture &&
      this.phase === 'cast' &&
      time >= this.cast.castTime! &&
      time - this.cast.castTime! <= 2000
    ) {
      this.cast.mooch = true
      this.cast.baitId = parameter
      this.cast.placeId = this.place
      this.capture.serverCastTime = time
      this.emit('place', time)
    } else if ([1111, 1112, 1113].includes(message)) {
      this.emit('quit', time)
      this.cast = this.capture = null
      this.phase = null
      this.place = this.pendingCommand = null
    } else if ([1117, 1118, 1119, 1120, 1127, 1129, 3527].includes(message)) {
      if (this.cast && this.capture && this.phase !== 'catch' && this.phase !== 'end') {
        this.phase = 'end'
        this.capture.terminal = true
        this.capture.gatheringFailed = message === 3527
        this.emit('end', time)
      }
    } else if (message === 5505) this.identical = parameter
    else if (message === 5506) this.slap = parameter
    else if (message === 11154) this.taskActive = true
    else if (message === 10769) this.taskActive = false
    else if (this.capture) {
      if (message === 5564) {
        this.capture.hidden = parameter
        const stacks = this.capture.lure <= 3 ? this.capture.lure : 8 - this.capture.lure
        const last = this.capture.lureTimes.at(-1)
        this.capture.hiddenStack =
          last !== undefined && (Math.abs(time - last) < 800 || stacks >= 3) ? stacks : stacks + 1
        if (this.capture.hiddenStack < 1 || this.capture.hiddenStack > 3) this.capture.unsupported = true
      }
      if (message === 5565 || message === 5569) this.capture.lureTarget = true
    }
    return true
  }
  private catch(fish: number, size: number, quantity: number, large: boolean, time: number): void {
    if (fish === 0 || !this.cast || !this.capture || this.phase === 'catch') return
    this.cast.fishId = fish
    this.capture.size = size
    this.capture.quantity = quantity
    this.capture.large = large
    this.capture.terminal = true
    this.phase = 'catch'
    this.emit('catch', time)
  }
  private observeActor(id: number, time: number): boolean {
    const own = this.options.actorId?.()
    if (own !== undefined && own !== null && own !== id) return false
    if (this.actor !== 0 && this.actor !== id) this.reset(time)
    this.actor = id
    return true
  }
  private emit(action: string, time: number): void {
    if (this.cast && action !== 'bait') {
      this.cast.action = action
      this.cast.time = time
    }
    const frame: FishingFrame = {
      action,
      time,
      castId: this.cast?.castId ?? null,
      castTime: this.cast?.castTime ?? null,
      biteTime: this.cast?.biteTime ?? null,
      hookTime: this.cast?.hookTime ?? null,
      baitId: this.cast?.baitId ?? null,
      baseBaitId: this.cast && action !== 'bait' ? this.cast.baseBaitId : this.bait,
      placeId: this.cast ? this.cast.placeId : this.place,
      tug: this.cast?.tug ?? null,
      fishId: this.cast?.fishId ?? null,
      mooch: this.cast?.mooch ?? null,
      chum: this.cast?.chum ?? null,
      snagging: this.cast?.snagging ?? null,
      statuses: this.cast?.statuses ?? null,
      capture: this.capture,
    }
    this.options.emit('Fishing', publicFrame(frame) as unknown as Json, time)
    this.options.observe?.(structuredClone(frame))
  }
}
