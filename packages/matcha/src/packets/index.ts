// Copyright (c) FFCafe. All rights reserved.
// Licensed under AGPL-3.0. Ported from Cafe.Matcha's NetworkMonitor and handlers.

import type { FateObservation } from '../exploration/eureka-types.js'
import type { MatchaEmitter, MatchaPacket } from '../protocol.js'
import { Payload } from './binary.js'
import { MarketPackets, type MatchaMarketService } from './market.js'

export type { MatchaMarketService } from './market.js'
export { createUniversalisClient } from './universalis.js'

export interface FateState {
  id: number
  startTime: number
  duration: number
  progress: number
}

export interface MatchaPacketState {
  world: number
  zone: number
  instance: number
  server: number
  content: number
  bait: number
  lastZoneChange: number
  fates: FateState[]
}

// ActorControl categories are stable protocol fields, not version-specific opcodes.
const control = {
  treasureSpot: 84,
  directorUpdate: 109,
  fishingBaitChange: 325,
  fateStart: 2370,
  fateEnd: 2357,
  fateProgress: 2364,
} as const

/** A fresh instance represents one capture/session. reset() also invalidates in-flight market responses. */
export class MatchaPacketHandlers {
  private world = 0
  private zone = 0
  private instance = 0
  private server = 0
  private content = 0
  private bait = 0
  private lastZoneChange = 0
  private readonly fates = new Map<number, FateState>()
  private readonly market: MarketPackets
  private readonly now: () => number
  private readonly diagnostic: (message: string) => void

  constructor(
    private readonly options: {
      emit: MatchaEmitter
      now?: () => number
      onDiagnostic?: (message: string) => void
      market?: MatchaMarketService
      onFateObservation?: (observation: FateObservation) => void
    },
  ) {
    this.now = options.now ?? Date.now
    this.diagnostic = options.onDiagnostic ?? (() => {})
    this.market = new MarketPackets({
      emit: options.emit,
      now: this.now,
      world: () => this.world,
      service: options.market,
      onDiagnostic: this.diagnostic,
    })
  }

  reset(): void {
    this.world = this.zone = this.instance = this.server = this.content = this.bait = this.lastZoneChange = 0
    this.fates.clear()
    this.market.reset()
  }

  /** Runtime can seed a world from a trusted session snapshot before a spawn packet arrives. */
  setWorld(world: number): void {
    if (!Number.isInteger(world) || world < 0 || world > 0xffff || world === this.world) return
    this.world = world
    this.market.reset()
    this.fates.clear()
  }

  snapshot(): MatchaPacketState {
    return {
      world: this.world,
      zone: this.zone,
      instance: this.instance,
      server: this.server,
      content: this.content,
      bait: this.bait,
      lastZoneChange: this.lastZoneChange,
      fates: [...this.fates.values()].map((state) => ({ ...state })),
    }
  }

  handle(packet: MatchaPacket): void {
    if (packet.channel !== 'zone') return
    const data = new Payload(packet.data)
    try {
      if (this.market.handle(packet, data)) return
      if (packet.direction !== 'recv') return
      switch (packet.type) {
        case 'PlayerSetup':
          data.require(8)
          this.reset()
          break
        case 'PlayerSpawn':
          data.require(24)
          if ((this.content === 0 || packet.sourceActor === packet.targetActor) && data.u16(0x14) !== 0)
            this.setWorld(data.u16(0x14))
          break
        case 'InitZone':
          data.require(136)
          this.server = data.u16(0)
          this.zone = data.u16(2)
          this.instance = data.u16(4)
          this.content = data.u16(6)
          this.lastZoneChange = packet.timestamp
          this.fates.clear()
          this.market.reset()
          this.options.emit('InitZone', { zone: this.zone, instance: this.content }, packet.timestamp)
          break
        case 'ResumeEventScene32':
          data.require(136)
          if (data.u32(0) === 0x250000) this.cactpot(data, true, packet.timestamp)
          break
        case 'ActorControlSelf':
          data.require(40)
          this.actorControl(data, packet.timestamp, packet.seq)
          break
        case 'FateInfo': {
          data.require(24)
          const fate = this.fate(data.u16(0))
          const startTime = data.u32(8)
          const duration = data.u32(16)
          this.options.onFateObservation?.({
            kind: 'info',
            fateId: fate.id,
            packetSeq: packet.seq,
            timestamp: packet.timestamp,
            startTimeSeconds: startTime,
            durationSeconds: duration,
          })
          if (fate.startTime !== startTime || fate.duration !== duration) {
            fate.startTime = startTime
            fate.duration = duration
          }
          break
        }
        case 'ContentFinderNotifyPop':
        case 'CFNotifyPop': {
          data.require(40)
          const roulette = data.u16(2)
          this.options.emit('MatchAlert', { roulette, instance: roulette === 0 ? data.u16(28) : 0 }, packet.timestamp)
          break
        }
        case 'WorldVisitQueue': {
          data.require(12)
          const stage = data.u32(0)
          this.options.emit(
            'Queue',
            {
              type: 'world-visit',
              stage: stage === 1 ? 'waiting' : stage === 2 ? 'ready' : stage === 3 ? 'done' : 'unknown',
              order: data.u32(4),
              time: data.u32(8),
            },
            packet.timestamp,
          )
          break
        }
        case 'CompanyAirshipStatus': {
          data.require(144)
          const list = Array.from({ length: 4 }, (_, index) => {
            const offset = index * 36
            return {
              returnTime: data.u32(offset),
              maxDistance: data.u16(offset + 4),
              name: data.text(offset + 6, 22),
              destination: Array.from({ length: 5 }, (_, slot) => data.u8(offset + 29 + slot)),
            }
          })
          this.options.emit('CompanyVoyageStatus', { type: 'airship', list }, packet.timestamp)
          break
        }
        case 'ItemInfo':
        case 'UpdateInventorySlot':
          this.equipment(data, packet.timestamp)
          break
        case 'InventoryTransaction':
          data.require(48)
          if (data.u16(12) === 1000)
            this.options.emit(
              'Gearset',
              {
                self: true,
                name: '',
                slot: data.u16(16),
                item: 0,
                hq: false,
                glamour: 0,
                materias: [],
              },
              packet.timestamp,
            )
          break
        case 'Examine':
          this.examine(data, packet.timestamp)
          break
        case 'CEDirector':
          data.require(13)
          this.options.emit(
            'DynamicEvent',
            {
              nextStage: data.u32(0),
              countdown: data.u32(4),
              zone: this.zone,
              event: data.u8(8),
              participants: data.u8(9),
              stage: data.u8(10),
              progress: data.u8(12),
            },
            packet.timestamp,
          )
          break
        case null:
          this.treasureResult(data, packet.timestamp)
          break
      }
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      this.diagnostic(`${packet.type ?? 'Unknown'}: ${error.message}`)
    }
  }

  private cactpot(data: Payload, isNewGame: boolean, timestamp: number): void {
    const x = data.u32(12)
    const y = data.u32(16)
    const value = data.u32(20)
    if (x > 2 || y > 2 || value < 1 || value > 9) return
    this.options.emit('MiniCactpot', { isNewGame, x, y, value }, timestamp)
  }

  private actorControl(data: Payload, timestamp: number, packetSeq: number): void {
    switch (data.u16(0)) {
      case control.treasureSpot:
        this.options.emit(
          'TreasureSpot',
          { item: data.u32(4), location: data.u32(8), isNew: data.u32(12) !== 0 },
          timestamp,
        )
        break
      case control.directorUpdate:
        if (data.u32(4) === 0x250000 && data.u32(8) === 2) this.cactpot(data, false, timestamp)
        break
      case control.fishingBaitChange:
        this.bait = data.u32(4)
        break
      case control.fateStart: {
        const fate = this.fate(data.u16(4))
        this.options.onFateObservation?.({ kind: 'start', fateId: fate.id, packetSeq, timestamp })
        this.options.emit('Fate', { type: 'start', fate: fate.id, progress: 0, extra: 0 }, timestamp)
        break
      }
      case control.fateProgress: {
        const fate = this.fate(data.u16(4))
        const progress = data.u8(8)
        if (progress > 100) return
        if (progress !== fate.progress) {
          fate.progress = progress
        }
        this.options.onFateObservation?.({ kind: 'progress', fateId: fate.id, packetSeq, timestamp, progress })
        this.options.emit('Fate', { type: 'progress', fate: fate.id, progress, extra: 0 }, timestamp)
        break
      }
      case control.fateEnd: {
        const id = data.u16(4)
        this.fates.delete(id)
        this.options.onFateObservation?.({ kind: 'end', fateId: id, packetSeq, timestamp, extra: data.u16(28) })
        this.options.emit('Fate', { type: 'end', fate: id, progress: 0, extra: data.u16(28) }, timestamp)
        break
      }
    }
  }

  private fate(id: number): FateState {
    const existing = this.fates.get(id)
    if (existing) return existing
    const fate = { id, startTime: 0, duration: 0, progress: 0 }
    if (this.fates.size >= 4096) this.fates.delete(this.fates.keys().next().value as number)
    this.fates.set(id, fate)
    return fate
  }

  private equipment(data: Payload, timestamp: number): void {
    data.require(64)
    if (data.u16(8) !== 1000) return
    this.options.emit(
      'Gearset',
      {
        self: true,
        name: '',
        slot: data.u16(10),
        item: data.u32(16),
        hq: data.u8(32) !== 0,
        glamour: data.u32(40),
        materias: Array.from({ length: 5 }, (_, index) => ({
          type: data.u16(44 + index * 2),
          tier: data.u8(54 + index),
        })),
      },
      timestamp,
    )
  }

  private examine(data: Payload, timestamp: number): void {
    // The migrated 7.x layout starts equipment at 0x50. Do not silently decode the older elpis 0x40 layout.
    data.require(944)
    const name = data.text(0x50 + 14 * 40, 32)
    for (let slot = 0; slot < 14; slot++) {
      const offset = 0x50 + slot * 40
      this.options.emit(
        'Gearset',
        {
          self: false,
          name,
          slot,
          item: data.u32(offset),
          glamour: data.u32(offset + 4),
          hq: data.u8(offset + 16) !== 0,
          materias: Array.from({ length: 5 }, (_, index) => ({
            type: data.u16(offset + 18 + index * 4),
            tier: data.u16(offset + 20 + index * 4),
          })),
        },
        timestamp,
      )
    }
  }

  private treasureResult(data: Payload, timestamp: number): void {
    // These packets have no named opcode in Matcha. Require both exact shape and the known scene discriminator.
    if (data.bytes.length === 56 && [7636061, 8508181, 9413549].includes(data.u32(24))) {
      const values = ['wheel-low', 'wheel-medium', 'wheel-high', 'wheel-shift', 'wheel-special', 'wheel-end']
      const value = values[data.u8(40) - 191]
      if (value) this.options.emit('TreasureResult', { value, round: 0 }, timestamp)
    } else if (data.bytes.length === 64 && data.u32(16) === 0x04482c03) {
      this.options.emit(
        'TreasureResult',
        { round: data.u8(32) + 1, value: data.u8(40) === 1 ? 'gate-open' : 'gate-fail' },
        timestamp,
      )
    }
  }
}
