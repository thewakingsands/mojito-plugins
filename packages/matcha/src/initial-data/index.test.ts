import { describe, expect, it } from 'vitest'
import type { MatchaPacket } from '../protocol.js'
import { InitialDataStore } from './index.js'

function setup(time = 1000, length = 2951, fish = [0, 1, 7], spear = [0, 303]): MatchaPacket {
  const data = new Uint8Array(length)
  if (length >= 2951) {
    data.set(new TextEncoder().encode('测试角色'), 0x34c)
    for (const bit of fish) data[0x771 + (bit >> 3)] |= 1 << (bit % 8)
    for (const bit of spear) data[0x85b + (bit >> 3)] |= 1 << (bit % 8)
  }
  return {
    seq: 0,
    timestamp: time,
    direction: 'recv',
    channel: 'zone',
    opcode: 1,
    type: 'PlayerSetup',
    sourceActor: 1,
    targetActor: 1,
    serverId: 1,
    ipcTimestamp: 1,
    data,
  }
}
const mapping = { fish: { 0: 0, 1: 20, 7: 10 }, spearfish: { 20000: 10, 20303: 30 } }
describe('initial fishing notebook', () => {
  it('reads LSB-first bitmaps, deduplicates item IDs and exports only fishcake fields', () => {
    const store = new InitialDataStore({ mapping })
    expect(store.snapshot).toBeNull()
    store.handle(setup())
    expect(store.snapshot).toMatchObject({
      characterName: '测试角色',
      fish: [10, 20],
      spearfish: [10, 30],
      canExport: true,
    })
    expect(JSON.parse(store.exportJson())).toEqual({ completed: [10, 20, 30], pinned: [], alarmFish: [] })
    expect(store.exportJson()).not.toContain('测试角色')
    const captured = store.snapshot!
    captured.fish.push(999)
    expect(store.snapshot!.fish).toEqual([10, 20])
  })
  it('keeps maps across zones but rejects old, cross-session, outgoing and late callbacks', () => {
    const store = new InitialDataStore({ mapping })
    store.handle(setup(2000))
    expect(store.handle({ ...setup(3000), type: 'InitZone' })).toBe(false)
    expect(store.handle({ ...setup(3000), direction: 'send' })).toBe(false)
    expect(store.handle(setup(1000))).toBe(false)
    expect(store.snapshot?.receivedAt).toBe(2000)
    const session = store.session
    store.reset()
    expect(store.handle(setup(4000), session)).toBe(false)
    store.dispose()
    expect(store.handle(setup(5000))).toBe(false)
    expect(store.snapshot).toBeNull()
  })
  it('invalidates a previously exportable snapshot on incomplete data or missing mapping', () => {
    const store = new InitialDataStore({ mapping })
    store.handle(setup())
    store.handle(setup(2000, 2950))
    expect(store.snapshot?.canExport).toBe(false)
    expect(() => store.exportJson()).toThrow('不完整')
    store.handle(setup(3000, 2951, [9]))
    expect(() => store.exportJson()).toThrow('映射')
    expect(store.snapshot?.spearfish).toEqual([10, 30])
    const unavailable = new InitialDataStore({ mapping: null })
    unavailable.handle(setup(1, 2951, [], []))
    expect(() => unavailable.exportJson()).toThrow('映射')
  })
  it('supports empty notebooks, extended payloads and the bundled offline mapping', () => {
    const store = new InitialDataStore()
    store.handle(setup(1, 3200, [], []))
    expect(store.snapshot?.canExport).toBe(true)
    expect(JSON.parse(store.exportJson()).completed).toEqual([])
  })
})
