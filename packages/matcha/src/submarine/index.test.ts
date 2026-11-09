import type { Json } from '@ffcafe/mojito-plugin-sdk'
import { describe, expect, it } from 'vitest'
import type { MatchaPacket } from '../protocol.js'
import { SubmarineHandler } from './index.js'

const packet = (type: string, data: Uint8Array): MatchaPacket => ({
  type,
  data,
  seq: 0,
  timestamp: 1000,
  direction: 'recv',
  channel: 'zone',
  opcode: 1,
  sourceActor: 1,
  targetActor: 1,
  serverId: 0,
  ipcTimestamp: 1,
})
function zone(id: number) {
  const data = new Uint8Array(136)
  new DataView(data.buffer).setUint16(2, id, true)
  return packet('InitZone', data)
}
function item(slot: number, condition = 12000, id = 700001, container = 25004) {
  const data = new Uint8Array(64),
    view = new DataView(data.buffer)
  view.setUint16(8, container, true)
  view.setUint16(10, slot, true)
  view.setUint32(16, id, true)
  view.setUint16(34, condition, true)
  return packet('ItemInfo', data)
}
describe('submarines', () => {
  it('requires workshop context, maps five-slot strides and preserves immutable condition snapshots', () => {
    const events: Json[] = [],
      handler = new SubmarineHandler((_type, content) => events.push(content))
    expect(handler.handle(item(0))).toBe(false)
    handler.handle(zone(423))
    for (let submarine = 0; submarine < 4; submarine++)
      for (let part = 0; part < 4; part++) handler.handle(item(submarine * 5 + part, 12000 + part))
    const old = handler.snapshot
    handler.handle({ ...item(18, 30000), type: 'UpdateInventorySlot' })
    expect(handler.snapshot.parts[3][3]?.condition).toBe(30000)
    expect(old.parts[3][3]?.condition).toBe(12003)
    handler.handle(item(18, 0))
    expect(handler.snapshot.parts[3][3]?.condition).toBe(0)
    handler.handle(item(18, 30001))
    expect(handler.snapshot.parts[3][3]).toBeNull()
    handler.handle(item(18, 30000))
    handler.handle(item(18, 30000, 0))
    expect(handler.snapshot.parts[3][3]).toBeNull()
    const count = events.length
    for (const invalid of [
      item(4),
      item(20),
      item(0, 12000, 1, 1),
      { ...item(0), direction: 'send' as const },
      packet('ItemInfo', new Uint8Array(63)),
    ])
      handler.handle(invalid)
    expect(events).toHaveLength(count)
    handler.handle(zone(100))
    expect(handler.handle(item(0))).toBe(false)
    handler.handle(zone(423))
    expect(handler.snapshot.parts[0][0]).toBeNull()
  })
  it('parses exact payload lengths and clears all character-owned voyage state on reset', () => {
    const events: { type: string; content: Json }[] = [],
      handler = new SubmarineHandler((type, content) => events.push({ type, content }))
    const statuses = new Uint8Array(240),
      view = new DataView(statuses.buffer)
    view.setUint16(2, 120, true)
    view.setUint32(8, 10000, true)
    view.setUint16(46, 123, true)
    statuses.set(new TextEncoder().encode('潜艇'), 22)
    statuses[54] = 4
    expect(handler.handle(packet('SubmarineStatusList', statuses))).toBe(true)
    expect(handler.snapshot.submarines[0]).toMatchObject({
      rank: 120,
      returnTime: 10000,
      hull: 123,
      name: '潜艇',
      destination: [4, 0, 0, 0, 0],
    })
    expect(handler.handle(item(0))).toBe(true)
    const voyages = new Uint8Array(144)
    new DataView(voyages.buffer).setUint32(0, 11000, true)
    expect(handler.handle(packet('CompanySubmersibleStatus', voyages))).toBe(true)
    expect(handler.snapshot.voyages[0].returnTime).toBe(11000)
    expect(handler.handle(packet('CompanySubmersibleStatus', new Uint8Array(176)))).toBe(false)
    handler.handle(packet('Logout', new Uint8Array()))
    expect(handler.snapshot.voyages).toEqual([])
    expect(handler.snapshot.submarines).toEqual([null, null, null, null])
  })
})
