// Ported from Cafe.Matcha (AGPL-3.0), InitialDataStore and PlayerSetupHandler.
import type { Json } from '@ffcafe/mojito-plugin-sdk'
import type { MatchaEmitter, MatchaPacket } from '../protocol.js'

export interface NotebookMapping {
  fish: Record<string, number>
  spearfish: Record<string, number>
}
export interface InitialDataSnapshot {
  characterName: string
  receivedAt: number
  fish: number[]
  spearfish: number[]
  error: string | null
  canExport: boolean
}

function validMapping(value: NotebookMapping | null): value is NotebookMapping {
  return (
    !!value &&
    [value.fish, value.spearfish].every(
      (rows, group) =>
        !!rows &&
        Object.keys(rows).length > 0 &&
        Object.entries(rows).every(
          ([key, item]) =>
            /^\d+$/.test(key) && Number(key) >= (group === 0 ? 0 : 20000) && Number.isSafeInteger(item) && item >= 0,
        ),
    )
  )
}

export class InitialDataStore {
  private current: InitialDataSnapshot | null = null
  private packet: MatchaPacket | null = null
  private generation = 0
  private active = true
  private readonly mapping: () => NotebookMapping | null
  private readonly emit?: MatchaEmitter
  constructor(
    options: { mapping?: NotebookMapping | null | (() => NotebookMapping | null); emit?: MatchaEmitter } = {},
  ) {
    this.mapping =
      typeof options.mapping === 'function'
        ? options.mapping
        : () => (options.mapping as NotebookMapping | null) ?? null
    this.emit = options.emit
  }
  get snapshot(): InitialDataSnapshot | null {
    return structuredClone(this.current)
  }
  /** Capture this token before asynchronous processing; old sessions cannot restore a snapshot. */
  get session(): number {
    return this.generation
  }
  reset(): void {
    this.generation++
    this.active = true
    this.current = null
    this.packet = null
    this.publish()
  }
  dispose(): void {
    this.generation++
    this.active = false
    this.current = null
    this.packet = null
    this.publish()
  }
  reloadMapping(): void {
    if (this.packet) this.handle(this.packet)
  }
  handle(packet: MatchaPacket, generation = this.generation): boolean {
    if (
      !this.active ||
      generation !== this.generation ||
      packet.direction !== 'recv' ||
      packet.channel !== 'zone' ||
      packet.type !== 'PlayerSetup'
    )
      return false
    if (this.current && packet.timestamp < this.current.receivedAt) return false
    this.packet = { ...packet, data: packet.data.slice() }
    const bytes = packet.data
    const next: InitialDataSnapshot = {
      characterName: '',
      receivedAt: packet.timestamp,
      fish: [],
      spearfish: [],
      error: null,
      canExport: false,
    }
    if (bytes.length < 2951) next.error = '初始数据包不完整，请重新登录游戏获取。'
    else {
      const name = bytes.subarray(0x34c, 0x34c + 32)
      const end = name.indexOf(0)
      next.characterName = new TextDecoder().decode(end < 0 ? name : name.subarray(0, end))
      const mapping = this.mapping()
      if (!validMapping(mapping)) next.error = '鱼种映射数据不可用，请检查客户端游戏数据。'
      else {
        const read = (offset: number, length: number, first: number, map: Record<string, number>, result: number[]) => {
          const items = new Set<number>()
          for (let bit = 0; bit < length * 8; bit++) {
            if ((bytes[offset + (bit >> 3)] & (1 << (bit % 8))) === 0) continue
            const id = map[String(first + bit)]
            if (id === undefined) next.error = '部分已完成鱼种缺少物品映射，请检查客户端游戏数据后重新登录游戏。'
            else if (id !== 0) items.add(id)
          }
          result.push(...[...items].sort((a, b) => a - b))
        }
        read(0x771, 191, 0, mapping.fish, next.fish)
        read(0x85b, 38, 20000, mapping.spearfish, next.spearfish)
      }
    }
    next.canExport = next.error === null
    this.current = next
    this.publish()
    return true
  }
  exportJson(): string {
    if (!this.current?.canExport)
      throw new Error(this.current?.error ?? '尚未收到当前角色的初始数据，请重新登录游戏获取。')
    return JSON.stringify(
      {
        completed: [...new Set([...this.current.fish, ...this.current.spearfish])].sort((a, b) => a - b),
        pinned: [],
        alarmFish: [],
      },
      null,
      2,
    )
  }
  private publish(): void {
    this.emit?.('InitialData', this.snapshot as unknown as Json, this.current?.receivedAt)
  }
}
