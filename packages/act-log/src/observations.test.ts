import type { DataService, Field, Observation, SessionSnapshot, SourceMeta } from '@ffcafe/mojito-plugin-sdk'
import { expect, it, vi } from 'vitest'
import { LogObservations } from './observations.js'

const meta: SourceMeta = {
  sessionId: 'synthetic',
  characterGeneration: 0,
  source: 'replay',
  observedAt: 2000,
  timeBase: 'packet-unix',
  clockGeneration: 0,
  sampleStartedAt: null,
  sampleEndedAt: null,
}
const source: SessionSnapshot = {
  state: 'replay',
  sessionId: meta.sessionId,
  characterGeneration: 0,
  process: null,
  build: null,
  opcodeVersion: null,
  region: null,
  login: 'unknown',
  character: null,
  uiLanguage: 'en',
  dataLanguage: 'en',
  capabilities: {},
  clock: { now: 2000, base: 'packet-unix', generation: 0, source: 'replay', paused: false },
}
const field = <T>(value: T): Field<T> => ({
  state: 'ok',
  value,
  from: 'memory',
  observedAt: meta.observedAt,
  timeBase: meta.timeBase,
})
async function setup() {
  const name = vi.fn(async (kind: string, id: number) => `${kind}-${id}`)
  const input = new LogObservations({
    name,
    rows: async () => [{ subrows: [{ cells: [1, 2, 3].map((value) => ({ type: 'number', value })) }] }],
  } as unknown as DataService)
  const consume = (value: Observation) => input.consume({ meta, value })
  await consume({ kind: 'snapshotStart', source })
  return { consume }
}
it('emits the frozen snapshot once, in zone, map, player, present combatants and ordered party order', async () => {
  const { consume } = await setup()
  const a = { id: 9, name: field('Synthetic'), hpMax: field(100) }
  expect(await consume({ kind: 'snapshotCombatant', combatant: a, presentInMemory: true })).toEqual([])
  await consume({ kind: 'snapshotCombatant', combatant: { id: 8, name: field('Packet only') }, presentInMemory: false })
  await consume({ kind: 'snapshotParty', party: field({ memberCount: 2, memberIds: [9, 8] }) })
  await consume({ kind: 'snapshotPlayer', player: { actorId: field(7), name: field('Synthetic player') } })
  await consume({ kind: 'snapshotZone', territoryType: field(10), mapId: field(11) })
  const rows = await consume({ kind: 'snapshotEnd' })
  expect(rows.map((r) => [r.type, r.timestamp, r.fields.join('|')])).toEqual([
    [1, 2000, '0A|territoryType-10'],
    [40, 2000, '11|placeName-1|placeName-2|placeName-3'],
    [2, 2000, '0007|Synthetic player'],
    [3, 2000, '0009|Synthetic|00|0|0000|00||0|0|0|100|0|0||||||'],
    [11, 2000, '2|0009|0008'],
  ])
  expect(await consume({ kind: 'memory', memory: { kind: 'party', memberCount: 2, memberIds: [9, 8] } })).toEqual([])
  const removed = await consume({ kind: 'memory', memory: { kind: 'combatantRemove', actorId: 9 } })
  expect(removed[0]).toEqual({ ...rows[3], type: 4 })
  expect(await consume({ kind: 'memory', memory: { kind: 'combatantRemove', actorId: 9 } })).toEqual([])
})
it('uses chat time for chat rows and the triggering packet time for status rows', async () => {
  const { consume } = await setup()
  const text = new TextEncoder()
  expect(
    await consume({
      kind: 'event',
      event: {
        type: 'gameLog',
        data: { time: 5, code: 10, sender: text.encode('Test'), message: text.encode('合成') },
      },
    }),
  ).toEqual([{ type: 0, timestamp: 5000, fields: ['000A', 'Test', '合成'] }])
  await consume({
    kind: 'memory',
    memory: { kind: 'combatant', combatant: { id: 9, name: field('Synthetic'), hpMax: field(111) } },
  })
  const status = {
    statusId: 11,
    param: 3,
    sourceActorId: 9,
    durationMs: 1250,
    observedAt: 3000,
    timeBase: 'packet-unix' as const,
  }
  const event = (kind: 'gained' | 'lost', seq: number, timestamp: number): Observation => ({
    kind: 'event',
    event: {
      type: 'statusSlotsChanged',
      packet: { seq, timestamp, sourceActorId: 9, targetActorId: 8 },
      data: { actorId: 9, slots: [], changes: [{ kind, slot: 0, statusId: 11, sourceActorId: 9, status }] },
    },
  })
  const fields = ['0B', 'status-11', '1.25', '0009', 'Synthetic', '0009', 'Synthetic', '03', 111, 111]
  expect(await consume(event('gained', 1, 3000))).toEqual([{ type: 26, timestamp: 3000, fields }])
  fields[2] = '0.00'
  expect(await consume(event('lost', 2, 4000))).toEqual([{ type: 30, timestamp: 4000, fields }])
})

it('keeps visible link text and escapes separators in chat fields', async () => {
  const { consume } = await setup()
  const text = new TextEncoder()
  const linkStart = [0x02, 0x27, 0x05, 0x03, 0x02, 0x01, 0x01, 0x03]
  const linkEnd = [0x02, 0x27, 0x05, 0xcf, 0x01, 0x01, 0x01, 0x03]
  const icon = [0x02, 0x12, 0x02, 0x02, 0x03]
  const sender = Uint8Array.from([...linkStart, ...text.encode('测试玩家'), ...linkEnd])
  const message = Uint8Array.from([
    ...text.encode('获得：'),
    ...icon,
    ...linkStart,
    ...text.encode('恢复药'),
    ...linkEnd,
    ...text.encode('。|\\n\r\n'),
  ])

  const rows = await consume({
    kind: 'event',
    event: { type: 'gameLog', data: { time: 5, code: 10, sender, message } },
  })
  expect(rows).toEqual([{ type: 0, timestamp: 5000, fields: ['000A', '测试玩家', '获得：恢复药。\\u007c\\\\n\\r\\n'] }])
})
