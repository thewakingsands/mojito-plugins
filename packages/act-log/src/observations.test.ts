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
const unknown = { state: 'unknown', reason: 'Not observed' } as const
async function setup() {
  const version = vi.fn(async () => 'synthetic')
  const name = vi.fn(async (kind: string, id: number) => `${kind}-${id}`)
  const input = new LogObservations({
    version,
    name,
    rows: async () => [{ subrows: [{ cells: [1, 2, 3].map((value) => ({ type: 'number', value })) }] }],
  } as unknown as DataService)
  const consume = (value: Observation) => input.consume({ meta, value })
  await consume({ kind: 'snapshotStart', source })
  return { consume, version, name, input }
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
it('uses source-specific chat and buff times and keeps the removed actor for the paired lost-status event', async () => {
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
    observedAt: 5,
    timeBase: 'packet-unix' as const,
  }
  const event = (kind: 'gained' | 'lost'): Observation => ({
    kind: 'event',
    event: {
      type: 'statusSlotsChanged',
      packet: { seq: 1, timestamp: 3000, sourceActorId: 9, targetActorId: 8 },
      data: { actorId: 9, slots: [], changes: [{ kind, slot: 0, statusId: 11, sourceActorId: 9, status }] },
    },
  })
  const fields = ['0B', 'status-11', '1.25', '0009', 'Synthetic', '0009', 'Synthetic', '03', 111, 111]
  expect(await consume(event('gained'))).toEqual([{ type: 26, timestamp: 3000, fields }])
  await consume({ kind: 'memory', memory: { kind: 'combatantRemove', actorId: 9 } })
  fields[2] = '0.00'
  expect(await consume(event('lost'))).toEqual([{ type: 30, timestamp: 3000, fields }])
})
it('defers game-data access until a lookup is needed and detects a change between batches', async () => {
  const { input, consume, version, name } = await setup()
  await consume({ kind: 'snapshotZone', territoryType: unknown, mapId: unknown })
  await input.beginBatch()
  expect(version).not.toHaveBeenCalled()
  await input.names.name('status', 3)
  await input.names.name('status', 3)
  expect(name).toHaveBeenCalledTimes(1)
  version.mockResolvedValue('changed')
  await expect(input.beginBatch()).rejects.toThrow('版本')
})
