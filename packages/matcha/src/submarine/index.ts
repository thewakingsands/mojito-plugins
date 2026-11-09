// Ported from Cafe.Matcha (AGPL-3.0), SubmarineHandler.
import type { Json } from '@ffcafe/mojito-plugin-sdk'
import type { MatchaEmitter, MatchaPacket } from '../protocol.js'

export interface SubmarinePart {
  itemId: number
  condition: number
}
export interface SubmarineStatus {
  index: number
  status: number
  rank: number
  birthdate: number
  returnTime: number
  currentExp: number
  totalExpForNextRank: number
  capacity: number
  name: string
  hull: number
  stern: number
  bow: number
  bridge: number
  destination: number[]
}
export interface VoyageStatus {
  returnTime: number
  maxDistance: number
  name: string
  destination: number[]
}
export interface SubmarineSnapshot {
  inWorkshop: boolean
  parts: (SubmarinePart | null)[][]
  submarines: (SubmarineStatus | null)[]
  voyages: VoyageStatus[]
}
const string = (data: Uint8Array, offset: number, length: number) => {
  const bytes = data.subarray(offset, offset + length)
  const end = bytes.indexOf(0)
  return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end))
}
export class SubmarineHandler {
  private state: SubmarineSnapshot = this.empty()
  constructor(private readonly emit: MatchaEmitter) {}
  private empty(): SubmarineSnapshot {
    return {
      inWorkshop: false,
      parts: Array.from({ length: 4 }, () => Array<null>(4).fill(null)),
      submarines: Array<null>(4).fill(null),
      voyages: [],
    }
  }
  get snapshot(): SubmarineSnapshot {
    return structuredClone(this.state)
  }
  reset(timestamp?: number): void {
    this.state = this.empty()
    this.emit('SubmarineParts', { reset: true, index: -1, parts: [] }, timestamp)
  }
  dispose(): void {
    this.reset()
  }
  handle(packet: MatchaPacket): boolean {
    if (packet.direction !== 'recv' || packet.channel !== 'zone') return false
    const bytes = packet.data,
      data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const u16 = (offset: number) => data.getUint16(offset, true)
    const u32 = (offset: number) => data.getUint32(offset, true)
    const publish = (type: string, content: unknown) =>
      this.emit(type, structuredClone(content) as Json, packet.timestamp)
    if (packet.type === 'InitZone') {
      this.reset(packet.timestamp)
      this.state.inWorkshop = bytes.length >= 4 && [423, 424, 425, 653, 984].includes(u16(2))
      return false
    }
    if (packet.type === 'PlayerSetup' || packet.type === 'Logout') {
      this.reset(packet.timestamp)
      return false
    }
    if (packet.type === 'ItemInfo' || packet.type === 'UpdateInventorySlot') {
      if (!this.state.inWorkshop || bytes.length < 64 || u16(8) !== 25004) return false
      const slot = u16(10),
        index = Math.floor(slot / 5),
        part = slot % 5
      if (index >= 4 || part >= 4) return false
      const itemId = u32(16),
        condition = u16(34)
      this.state.parts[index][part] = itemId === 0 || condition > 30000 ? null : { itemId, condition }
      publish('SubmarineParts', { reset: false, index, parts: this.state.parts[index] })
      return true
    }
    if (packet.type === 'CompanySubmersibleStatus') {
      if (bytes.length !== 144) return false
      this.state.voyages = Array.from({ length: 4 }, (_, i) => {
        const offset = i * 36
        return {
          returnTime: u32(offset),
          maxDistance: u16(offset + 4),
          name: string(bytes, offset + 8, 22),
          destination: [...bytes.subarray(offset + 31, offset + 36)],
        }
      })
      publish('CompanyVoyageStatus', { type: 'submersible', list: this.state.voyages })
      return true
    }
    if (packet.type === 'SubmarineStatusList') {
      if (bytes.length !== 240) return false
      this.state.inWorkshop = true
      this.state.submarines = Array.from({ length: 4 }, (_, index) => {
        const offset = index * 60
        const status: SubmarineStatus = {
          index,
          status: u16(offset),
          rank: u16(offset + 2),
          birthdate: u32(offset + 4),
          returnTime: u32(offset + 8),
          currentExp: u32(offset + 12),
          totalExpForNextRank: u32(offset + 16),
          capacity: u16(offset + 20),
          name: string(bytes, offset + 22, 20),
          hull: u16(offset + 46),
          stern: u16(offset + 48),
          bow: u16(offset + 50),
          bridge: u16(offset + 52),
          destination: [...bytes.subarray(offset + 54, offset + 59)],
        }
        publish('SubmarineStatus', status)
        return status
      })
      return true
    }
    return false
  }
}
