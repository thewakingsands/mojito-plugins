import { Buffer } from 'node:buffer'
import type { DataService, Packet } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { Actors, Names } from './actors.js'
import { packetRows, type State } from './packets.js'

function state(): State {
  const actors = new Actors()
  actors.update(9, { name: 'Source', hpCur: 123, hpMax: 321 })
  return {
    actors,
    names: new Names(
      { version: async () => 'synthetic', name: vi.fn(async () => 'Skill') } as unknown as DataService,
      'en',
    ),
    player: null,
    marks: new Set(),
    primary: () => [],
    zone: async () => [],
  }
}
function packet(type: string, bytes: Uint8Array): Packet {
  return {
    type,
    data: bytes,
    seq: 1,
    opcode: 0,
    channel: 'zone',
    direction: 'recv',
    sourceActor: 9,
    targetActor: 8,
    timestamp: 1,
    ipcTimestamp: 0,
    serverId: 0,
  }
}
function effect(aoe: boolean) {
  const capacity = aoe ? 8 : 1
  const b = Buffer.alloc(aoe ? 48 + capacity * 72 + 8 : 120)
  b.writeUInt32LE(0x39, 8)
  b.writeUInt32LE(0x123, 12)
  b.writeFloatLE(0.5, 16)
  b.writeUInt16LE(0x8000, 26)
  b.writeUInt16LE(0x41, 28)
  b[31] = 1
  b[33] = aoe ? 2 : 1
  for (let t = 0; t < b[33]; t++) {
    b.writeUInt32LE(0x30 + t, 48 + capacity * 64 + t * 8)
    for (let i = 0; i < 8; i++) {
      if (i === 3) continue
      const offset = 42 + (t * 8 + i) * 8
      b.writeUInt32LE(0x10 * (t + 1) + i, offset)
      b.writeUInt32LE(0x100 * (t + 1) + i, offset + 4)
    }
  }
  return packet(aoe ? 'AoeEffect8' : 'Effect', b)
}

const first = ['10', '100', '11', '101', '12', '102', '0', '0', '14', '104', '15', '105', '16', '106', '17', '107']
const second = ['20', '200', '21', '201', '22', '202', '0', '0', '24', '204', '25', '205', '26', '206', '27', '207']
it.each([false, true])(
  'keeps eight independent effect pairs and the 3.0.3.3 field boundaries (AOE %s)',
  async (aoe) => {
    const rows = await packetRows(state(), effect(aoe))
    expect(rows).toHaveLength(aoe ? 2 : 1)
    for (const [i, r] of rows.entries()) {
      expect(r.type).toBe(aoe ? 22 : 21)
      expect(r.fields.slice(0, 6)).toEqual(['09', 'Source', '41', 'Skill', i ? '31' : '30', ''])
      expect(r.fields.slice(6, 22)).toEqual(i ? second : first)
      expect(r.fields.slice(22, 42)).toEqual([
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        123,
        321,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ])
      expect(r.fields.slice(42)).toEqual(['00000123', i, aoe ? 2 : 1, '00', '', '01', '39', '41', '0.500', '8000'])
    }
  },
)
it('writes an empty target with eight zero effect pairs when the action has no targets', async () => {
  const p = effect(true)
  p.data[33] = 0
  const [r] = await packetRows(state(), p)
  expect(r.type).toBe(21)
  expect(r.fields[4]).toBe('E0000000')
  expect(r.fields.slice(6, 22)).toEqual(Array(16).fill('0'))
  expect(r.fields.slice(43, 45)).toEqual([0, 0])
})
it('rejects truncated effects and excess target counts', async () => {
  await expect(packetRows(state(), packet('Effect', new Uint8Array(40)))).rejects.toThrow()
  const p = effect(true)
  p.data[33] = 9
  await expect(packetRows(state(), p)).rejects.toThrow('layout')
})
it('uses all sixteen gauge bytes including its reserved byte', async () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, i) => i + 1)
  expect(await packetRows(state(), packet('ActorGauge', bytes))).toEqual([
    { type: 31, fields: ['09', '4030201', '8070605', 'C0B0A09', '100F0E0D'] },
  ])
})

it.each([
  [6, [15, 0, 0, 0, 0], 25, '09|Source|0F|'],
  [15, [0, 0, 0x39, 1, 0], 23, '09|Source|39|Skill|Interrupted'],
  [34, [0x41, 2, 3, 4, 5], 27, '09|Source|0000|0000|0041|0002|0003|0004'],
  [54, [1, 0, 0, 0, 0], 34, '09|Source|09|Source|01'],
  [35, [1, 2, 15, 4, 5], 35, '09|Source|0F||0000|0001|0002|000F|0004|0005'],
] as const)('formats control category %s from synthetic parameters', async (type, params, line, expected) => {
  const data = Buffer.alloc(24)
  data.writeUInt16LE(type)
  for (const [i, n] of params.entries()) data.writeUInt32LE(n, 4 + i * 4)
  const [r] = await packetRows(state(), packet('ActorControl', data))
  expect(r?.type).toBe(line)
  expect(r.fields.join('|')).toBe(expected)
})
it('formats a cast from the source position, independently of the cast destination', async () => {
  const data = Buffer.alloc(32)
  data.writeUInt16LE(0x39)
  data.writeFloatLE(1.25, 8)
  data.writeUInt32LE(0x33, 12)
  const s = state()
  s.actors.update(9, { position: { x: 1, y: 2, z: 3 }, rotation: 0.25 })
  const [r] = await packetRows(s, packet('ActorCast', data))
  expect(r.fields.join('|')).toBe('0009|Source|39|Skill|0033||1.250|1.00|3.00|2.00|0.25')
})
it('retains the raw duration word and interior empty status slots', async () => {
  const b = Buffer.alloc(360)
  b.writeUInt32LE(0x70023, 24)
  b.writeUInt32LE(0xbfa00000, 28)
  b.writeUInt32LE(0x111, 32)
  const [r] = await packetRows(state(), packet('StatusEffectList3', b))
  expect(r).toEqual({
    type: 42,
    fields: ['0009', 'Source', '0', '0', '0', '0', '0', '0', '070023', 'BFA00000', '0111'],
  })
})
it('keeps Basic resource fields absent even when the actor already has a known maximum HP', async () => {
  const b = Buffer.alloc(24)
  b[0] = 1
  b.writeUInt32LE(0x23, 4)
  b.writeUInt32LE(0x99, 8)
  b.writeUInt32LE(45, 12)
  const [r] = await packetRows(state(), packet('EffectResultBasic', b))
  expect(r.fields.join('|')).toBe('0009|Source|00000023|45|||||||||')
})
it('distinguishes the ordinary and Foray3 status lists', async () => {
  for (const [type, offset, line] of [
    ['StatusEffectList', 0, 38],
    ['StatusEffectListForay3', 4, 43],
  ] as const) {
    const b = Buffer.alloc(384 + offset)
    b.writeUInt32LE(0x04030201, offset)
    b.writeUInt32LE(12, offset + 4)
    b.writeUInt32LE(64, offset + 8)
    const [r] = await packetRows(state(), packet(type, b))
    expect(r.type).toBe(line)
    expect(r.fields.slice(0, 8)).toEqual(['0009', 'Source', '04030201', 12, 64, 0, 0, 0])
  }
})
it.each([
  ['StatusEffectList', 0, 38],
  ['StatusEffectList2', 4, 38],
  ['StatusEffectListForay3', 4, 43],
] as const)('puts the shield and first occupied status in the 3.0.3.3 columns for %s', async (type, offset, line) => {
  const b = Buffer.alloc(384 + offset)
  b.set([23, 55, 7, 1], offset + 16)
  b.writeUInt32LE(0x1230008, offset + 20)
  b.writeFloatLE(2.5, offset + 24)
  b.writeUInt32LE(0x88, offset + 28)
  const [r] = await packetRows(state(), packet(type, b))
  expect(r.type).toBe(line)
  expect(r.fields[7]).toBe(23)
  const status = ['01230008', '40200000', '88']
  expect(r.fields.slice(13)).toEqual(line === 43 ? status : ['0737', '01', '0', ...status])
})
it('writes the full effect result, including raw signed duration bits and byte-width status words', async () => {
  const b = Buffer.alloc(96)
  b[0] = 1
  b.writeUInt32LE(0x123, 4)
  b.writeUInt32LE(123, 12)
  b.writeUInt32LE(456, 16)
  b.set([16, 0, 2, 17, 13, 1, 23, 1, 3, 5, 0x63, 0, 7, 0, 2, 0], 20)
  b.writeFloatLE(-3.125, 36)
  b.writeUInt32LE(9, 40)
  const [r] = await packetRows(state(), packet('EffectResult', b))
  expect(r.fields.join('|')).toBe(
    '0009|Source|00000123|123|456|16|10000|13||||||1102|0|0117|01|03050063|020007|C0480000|09',
  )
})

it('keeps system message parameter slots including the count and unused positions', async () => {
  const b = Buffer.alloc(24)
  b.writeUInt32LE(1, 0)
  b.writeUInt32LE(2, 4)
  b[8] = 1
  b[12] = 0x11
  const [r] = await packetRows(state(), packet('SystemLogMessage', b))
  expect(r).toEqual({ type: 41, fields: ['01', '02', '01', '11', '00'] })
})
it('uses the recorded marker position and deletes an active marker once', async () => {
  const s = state(),
    b = Buffer.alloc(16)
  b[0] = 2
  b[1] = 1
  b.writeInt32LE(-1250, 4)
  b.writeInt32LE(3250, 8)
  b.writeInt32LE(2000, 12)
  const p = packet('PlaceFieldMarker', b)
  const expected = [2, '0009', 'Source', '-1.25', '2.00', '3.25']
  expect(await packetRows(s, p)).toEqual([{ type: 28, fields: ['Add', ...expected] }])
  b[1] = 0
  expect(await packetRows(s, p)).toEqual([{ type: 28, fields: ['Delete', ...expected] }])
  expect(await packetRows(s, p)).toEqual([])
})
it('outputs Director and limit break parameters, and ignores an empty Director command', async () => {
  const b = Buffer.alloc(32)
  b.writeUInt16LE(109)
  b[4] = 1
  b.writeUInt32LE(0x40000001, 8)
  const p = packet('ActorControlSelf', b)
  expect(await packetRows(state(), p)).toEqual([{ type: 33, fields: ['01', '40000001', '00', '00', '00', '00'] }])
  b.writeUInt32LE(0x40000000, 8)
  expect(await packetRows(state(), p)).toEqual([])
  b.writeUInt16LE(505)
  b.writeUInt32LE(32, 8)
  expect(await packetRows(state(), p)).toEqual([{ type: 36, fields: ['0020', 1] }])
})
it('keeps the source of an aggregated tick absent and uses the recorded resource update', async () => {
  const b = Buffer.alloc(24),
    s = state()
  b.writeUInt16LE(1541)
  b[8] = 16
  b[12] = 9
  const [r] = await packetRows(s, packet('ActorControl', b))
  expect(r.fields.join('|')).toBe(
    [
      '0009',
      'Source',
      'DoT',
      '0',
      '10',
      123,
      321,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '0',
      ...Array(10).fill(''),
    ].join('|'),
  )
  const hp = Buffer.alloc(8)
  hp[0] = 75
  hp[4] = 17
  const [update] = await packetRows(s, packet('UpdateHpMpTp', hp))
  expect(update).toEqual({ type: 39, fields: ['09', 'Source', 75, 321, 17, '', '', '', '', '', '', ''] })
})
it('writes changed player attributes with the observed identity and keeps duplicate attributes out', async () => {
  const s = state()
  s.player = 9
  s.actors.update(9, { classJob: 3 })
  s.contentId = 0x123456789n
  const b = Buffer.alloc(224)
  b.writeUInt32LE(11)
  b.writeUInt32LE(25, 48)
  const p = packet('PlayerStats', b)
  expect(await packetRows(s, p)).toEqual([
    { type: 12, fields: [3, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 25, '123456789'] },
  ])
  expect(await packetRows(s, p)).toEqual([])
})
