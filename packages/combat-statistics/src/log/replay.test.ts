import { periodicDefs } from '@ffcafe/mojito-combat-model/defs'
import type {
  Batch,
  GameTopics,
  Limits,
  PluginContext,
  Sample,
  SessionSnapshot,
  Value,
} from '@ffcafe/mojito-plugin-sdk'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DamageAttribution, GameEvent } from '../combat-events.js'
import { displaySummary } from '../display.js'
import { activate, PUBLISH_MS } from '../entry.js'
import { attribution, castSpace, effect, meta, sample, tick } from '../fixtures.js'
import { defaults, REFLECT_SKILL, type Summary } from '../model.js'
import type { StatisticsState, VisitsState } from '../view-model.js'
import { CombatLog } from './index.js'
import { replay } from './replay.js'
import { memoryStorage } from './storage.test-helper.js'
import type { LogRecord } from './types.js'

const batch = <T>(items: T[]): Batch<T> => ({
  subscriptionId: 'test',
  batchId: 1,
  firstSeq: 1,
  lastSeq: items.length,
  initial: false,
  complete: true,
  items,
})
const subscription = () => ({ ready: Promise.resolve(), closed: new Promise<never>(() => {}), dispose() {} })
const T = new Date(2026, 9, 26, 20, 0).getTime()

/** Drives the real plugin entry with synthetic inputs; only the parts the combat log needs are modeled. */
async function plugin(memory = memoryStorage(), npcPartyMember = false) {
  const listeners = new Map<string, (batch: Batch<never>) => Promise<void>>()
  const timers: (() => Promise<void>)[] = []
  const commands = new Map<string, (input: Value) => Promise<Value>>()
  const snapshots = new Map<string, Value>()
  let now = T
  const field = <V>(value: V) => ({ state: 'ok', value, observedAt: now, from: 'packet', timeBase: 'packet-unix' })
  const entity = (id: number, name: string, extra: object = {}) => ({
    id,
    name: field(name),
    ownerId: field(null),
    bNpcBase: field(0),
    objectKind: field(1),
    ...extra,
  })
  const combatants = () => [
    entity(1, 'Self'),
    entity(5, 'Ally'),
    entity(6, 'Stranger'),
    entity(9, 'Boss', { bNpcBase: field(77), objectKind: field(2) }),
    ...(npcPartyMember ? [entity(4, 'Trust', { bNpcBase: field(1000), objectKind: field(2), subKind: field(9) })] : []),
  ]
  let serviceRequest!: (method: string, payload: Value) => Promise<Value>
  // While set, reading the combatants fails, which pauses the statistics.
  let readsFail = false
  const ctx = {
    identity: { activationId: 'replay', version: '1.0.0' },
    limits: { values: { 'game.entities': 512 } } as unknown as Limits,
    capabilities: { get: () => ({ granted: ['data.read'], supported: {} }) },
    log: { debug() {}, error() {}, info() {}, warn() {} },
    config: { get: async () => null, set: async () => {} },
    storage: memory.storage,
    session: {
      subscribe: (listener: never) => {
        listeners.set('session', listener)
        return subscription()
      },
    },
    events: {
      subscribe: (selection: string[], listener: never) => {
        listeners.set(
          selection.includes('actionEffect') ? 'events' : selection.includes('potencySample') ? 'potency' : 'review',
          listener,
        )
        return subscription()
      },
    },
    data: { name: async () => '区域', rows: async () => [] },
    game: {
      getPlayer: async () => ({
        meta: meta(now),
        value: { actorId: field(1), name: field('Self'), inCombat: { state: 'unavailable', reason: 'x' } },
      }),
      subscribe: (topic: string, listener: never, options?: { ids?: number[] }) => {
        listeners.set(options?.ids ? 'positions' : topic, listener)
        return subscription()
      },
      getCombatants: async () => {
        if (readsFail) throw { code: 'unavailable' }
        return { meta: meta(now), value: { missingIds: [], entities: combatants() } }
      },
    },
    clock: {
      now: () => now,
      state: () => ({ paused: false }),
      setTimeout: (callback: () => Promise<void>) => {
        timers.push(callback)
        return () => {}
      },
    },
    services: {
      provide: async (
        _definition: unknown,
        handler: (request: { method: string; payload: Value }) => Promise<Value>,
      ) => {
        serviceRequest = (method, payload) => handler({ method, payload })
        return () => {}
      },
      publish: async (_name: string, _event: string, envelope: { state: Value }) => {
        snapshots.set('combat', envelope.state)
      },
    },
    views: {
      set: (channel: string, value: Value) => {
        snapshots.set(channel, value)
      },
      flush: async () => {},
      onCommand: async (channel: string, handler: (input: Value) => Promise<Value>) => {
        commands.set(channel, handler)
        return () => {}
      },
    },
    ui: { registerFeature: async () => () => {} },
  } as unknown as PluginContext
  const dispose = await activate(ctx)
  const send = <V>(name: string, items: V[]) => listeners.get(name)!(batch(items) as never)
  await send('session', [
    {
      state: 'replay',
      opcodeVersion: periodicDefs.version,
      sessionId: 'source',
      characterGeneration: 1,
      clock: { generation: 1 },
      character: { actorId: 1 },
      dataLanguage: 'chs',
    } as SessionSnapshot,
  ])
  return {
    memory,
    dispose,
    commands,
    serviceRequest,
    field,
    snapshot: (channel: string) => snapshots.get(channel) as unknown,
    current: () => (snapshots.get('statistics') as { current: { id: string } | null }).current?.id ?? '',
    at: (value: number) => {
      now = value
    },
    events: async (items: Sample<GameEvent>[]) => {
      await send('events', items)
      // Runs the publication the plugin delays after events.
      await vi.advanceTimersByTimeAsync(PUBLISH_MS)
    },
    review: (items: Sample<GameEvent>[]) => send('review', items),
    zone: (territoryType: number) =>
      send('zone', [{ meta: meta(now), value: { territoryType: field(territoryType), mapId: field(1) } }]),
    party: (list: { id: number; ownParty: boolean }[]) =>
      send('party', [
        {
          meta: meta(now),
          value: {
            isInParty: field(true),
            members: field(list.map((member, slot) => ({ ...member, slot, name: `P${member.id}` }))),
          },
        } as unknown as Sample<GameTopics['party']>,
      ]),
    player: (inCombat: boolean | null) =>
      send('player', [
        {
          meta: meta(now),
          value: {
            actorId: field(1),
            name: field('Self'),
            inCombat: inCombat === null ? { state: 'unavailable', reason: 'x' } : field(inCombat),
          },
        },
      ]),
    entities: () => send('entities', [{ meta: meta(now), value: { entities: combatants(), missingIds: [] } }]),
    positions: (x: number) =>
      listeners.get('positions')?.(
        batch([
          {
            meta: meta(now),
            value: {
              entities: [
                { id: 1, position: field({ x, y: 0, z: 1 }), rotation: field(0), hpCur: field(1), hpMax: field(2) },
              ],
              missingIds: [],
            },
          },
        ]) as never,
      ),
    timer: () => timers.at(-1)!(),
    setReadsFail: (value: boolean) => {
      readsFail = value
    },
  }
}
const hp = (seq: number, actorId: number, hpCur: number, hpMax: number | null, sequence: number | null): GameEvent => ({
  type: 'hpChanged',
  packet: { seq, timestamp: seq, sourceActorId: actorId, targetActorId: actorId },
  data: { origin: 'effectResult' as const, actorId, hpCur, hpMax, sequence },
})

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})
it('replays every visit from the log into the same summaries as the live statistics', async () => {
  const h = await plugin()
  const party = [
    { id: 1, ownParty: true },
    { id: 5, ownParty: false },
  ]
  // The host pushes zone, party and player again on every poll even when only their observation times move.
  const repeat = async (territoryType: number) => {
    await h.zone(territoryType)
    await h.party(party)
    await h.player(false)
  }
  await h.zone(1263)
  await h.party(party)
  await h.entities()
  h.at(T + 500)
  await h.player(false)
  await repeat(1263)
  // Fight 1: opened by a hit, split from fight 2 by quiet time inside the next event.
  await h.events([sample(effect(1, 100), T + 1000), sample(effect(2, 30, 5), T + 1500)])
  await h.positions(1)
  h.at(T + 5000)
  await repeat(1263)
  h.at(T + 12_000)
  await h.events([sample(effect(3, 200), T + 12_000)])
  // Fight 2: a periodic tick, a scope change and a quiet end decided by the timer.
  await h.events([sample({ type: 'periodicTick', data: tick({ occurredAt: T + 13_000 }) }, T + 13_000)])
  await h.review([
    sample(
      {
        type: 'castStarted',
        packet: effect(4).packet,
        data: { ...castSpace, casterId: 9, actionId: 5, targetId: 1, durationMs: 1 },
      },
      T + 13_100,
    ),
  ])
  await h.commands.get('statistics')!({
    kind: 'settings',
    value: { mode: 'auto', quietSeconds: 10, mergePets: true, scope: 'alliance' },
  })
  await h.events([sample(effect(5, 50, 5), T + 14_000), sample(effect(6, 70, 6), T + 14_500)])
  h.at(T + 30_000)
  await h.timer()
  // A post revision for fight 2 after it ended.
  await h.events([
    sample(
      {
        type: 'periodicRevision',
        data: {
          estimatorGeneration: 1,
          ticks: [
            tick({
              occurredAt: T + 13_000,
              phase: 'post',
              shares: [{ sourceId: 1, statusId: 1, amount: 90, basis: 'exact' }],
            }),
          ],
        },
      },
      T + 30_100,
    ),
  ])
  // Fight 3: the source clock is already past the quiet deadline when the event is applied.
  h.at(T + 60_000)
  await h.events([sample(effect(7, 10), T + 40_000)])
  // Fight 4: ended from the overlay.
  h.at(T + 70_000)
  await h.events([sample(effect(8, 40), T + 70_000)])
  await h.serviceRequest('endEncounter', { encounterId: h.current() })
  // Fight 5: cut by a zone change, which starts the second visit.
  h.at(T + 80_000)
  await h.events([sample(effect(9, 60), T + 80_000), sample(hp(20, 1, 5000, 10_000, null), T + 80_100)])
  h.at(T + 82_000)
  await repeat(1263)
  h.at(T + 85_000)
  await h.zone(339)
  // The first player state of the new visit repeats the last one of the old visit, but the zone change cleared the combat state.
  h.at(T + 85_500)
  await h.player(false)
  h.at(T + 85_600)
  await repeat(339)
  // Fight 6: its heal is measured against the HP received in the first visit, then it is ended from the overlay.
  const heal = effect(21, 8000, 1, 1, 4)
  heal.data.sequence = 90
  await h.events([
    sample(effect(10, 25), T + 86_000),
    sample(heal, T + 86_100),
    sample(hp(22, 1, 10_000, null, 90), T + 86_200),
  ])
  h.at(T + 87_000)
  await h.serviceRequest('endEncounter', { encounterId: h.current() })
  // The plugin still holds every fight of this activation, so selecting one shows its live summary.
  const live: Summary[] = []
  for (const visit of [...(h.snapshot('visits') as VisitsState).visits].reverse())
    for (const fight of visit.fights) {
      await h.commands.get('statistics')!({ kind: 'select', visitId: visit.id, fightId: fight.id })
      live.push((h.snapshot('statistics') as StatisticsState).selected!)
    }
  await h.dispose()

  expect(live.map((summary) => summary.reason)).toEqual(['quiet', 'quiet', 'quiet', 'manual', 'zoneChanged', 'manual'])
  expect(live.at(-1)!.rows.find((row) => row.actor.id === 1)!.totals).toMatchObject({ overhealed: 3000 })

  const log = new CombatLog(h.memory.storage, { values: {} } as unknown as Limits, {
    createdBy: 'test',
    actors: () => new Map(),
    names: { zone: () => null, job: () => null },
    brief: () => ({ result: null, mainEnemy: null }),
    positions: () => {},
  })
  await log.open()
  const visits = log.list().reverse()
  expect(visits.map((visit) => visit.territoryType)).toEqual([1263, 339])
  const replayed: Summary[] = []
  for (const visit of visits) {
    const records: LogRecord[] = []
    for await (const record of log.read(visit.id)) records.push(record)
    replayed.push(...(await replay(records)))
    // After the entry snapshot, each zone, party and player value is written once however often it was pushed.
    const written = new Map<string, string[]>()
    const strip = (value: object) =>
      JSON.stringify(Object.entries(value).map(([name, field]) => [name, { ...field, observedAt: undefined }]))
    const start = records.findIndex((record) => record.kind === 'identities' && record.origin === 'snapshot')
    for (const record of records.slice(start + 1))
      if (record.kind === 'zone' || record.kind === 'party' || record.kind === 'player') {
        const key = record.kind === 'player' ? `player:${record.origin}` : record.kind
        written.set(key, [...(written.get(key) ?? []), strip(record.value)])
      }
    expect([...written.keys()].sort()).toEqual(['party', 'player:watch', 'zone'])
    for (const values of written.values()) expect(new Set(values).size).toBe(values.length)
  }
  expect(replayed.map((summary) => summary.id)).toEqual(live.map((summary) => summary.id))
  expect(replayed.map((summary) => displaySummary(summary, true))).toEqual(live)
  expect(replayed.at(-1)!.rows.find((row) => row.actor.id === 1)!.totals).toMatchObject({ overhealed: 3000 })
  expect(log.list().every((visit) => visit.integrity === 'verified')).toBe(true)
})
it('replays the splits of the host and their deltas into the same rDPS', async () => {
  const h = await plugin()
  await h.zone(1263)
  await h.party([
    { id: 1, ownParty: true },
    { id: 5, ownParty: true },
  ])
  await h.entities()
  const split = (seq: number | null, data: Partial<DamageAttribution>): GameEvent => ({
    type: 'damageAttributed',
    ...(seq === null ? {} : { packet: effect(seq).packet }),
    data: attribution(data),
  })
  await h.events([
    sample(effect(1, 10000, 1), T + 1000),
    sample(
      split(1, { id: 1, attackerId: 1, actorId: 1, contributions: [{ statusId: 786, sourceId: 5, amount: 600 }] }),
      T + 1000,
    ),
    sample(effect(2, 5000, 5), T + 1500),
    sample(
      split(2, {
        id: 2,
        attackerId: 5,
        actorId: 5,
        amount: 5000,
        unattributed: 0,
        contributions: [{ statusId: 1878, sourceId: 1, amount: 300 }],
      }),
      T + 1500,
    ),
    sample(
      {
        type: 'periodicTick',
        data: tick({ occurredAt: T + 2000, shares: [{ sourceId: 1, statusId: 1, amount: 90, basis: 'exact' }] }),
      },
      T + 2000,
    ),
    sample(
      split(null, {
        id: 3,
        origin: { type: 'tick', tickId: 1, statusId: 1 },
        attackerId: 1,
        actorId: 1,
        amount: 90,
        unattributed: 0,
        contributions: [{ statusId: 786, sourceId: 5, amount: 9 }],
      }),
      T + 2000,
    ),
  ])
  h.at(T + 30_000)
  await h.timer()
  // The window of the host closes after the fight: the deltas, then the periodic revision
  await h.events([
    sample(
      {
        type: 'attributionRevision',
        data: {
          estimatorGeneration: 1,
          records: [
            {
              id: 1,
              tickId: null,
              actorId: 1,
              origin: { type: 'action', actionId: 10 },
              unattributed: 0,
              contributions: [{ statusId: 786, sourceId: 5, amount: -50 }],
            },
            {
              id: null,
              tickId: 1,
              actorId: 1,
              origin: { type: 'tick', statusId: 1 },
              unattributed: 0,
              contributions: [{ statusId: 786, sourceId: 5, amount: 1 }],
            },
          ],
        },
      },
      T + 30_050,
    ),
    sample(
      {
        type: 'periodicRevision',
        data: {
          estimatorGeneration: 1,
          ticks: [
            tick({
              occurredAt: T + 2000,
              phase: 'post',
              shares: [{ sourceId: 1, statusId: 1, amount: 90, basis: 'exact' }],
            }),
          ],
        },
      },
      T + 30_100,
    ),
  ])
  const live: Summary[] = []
  for (const visit of (h.snapshot('visits') as VisitsState).visits)
    for (const fight of visit.fights) {
      await h.commands.get('statistics')!({ kind: 'select', visitId: visit.id, fightId: fight.id })
      live.push((h.snapshot('statistics') as StatisticsState).selected!)
    }
  await h.dispose()
  expect(live).toHaveLength(1)
  const ally = live[0].rows.find((row) => row.actor.id === 5)!
  expect(ally.skills['status:786'].contribution).toBe(600 - 50 + 9 + 1)
  expect(ally.skills['status:786'].contributionDps.value).toBeGreaterThan(0)
  expect(live[0].rows.find((row) => row.actor.id === 1)!.metrics.contributionDps.quality).not.toBe('unavailable')

  const log = new CombatLog(h.memory.storage, { values: {} } as unknown as Limits, {
    createdBy: 'test',
    actors: () => new Map(),
    names: { zone: () => null, job: () => null },
    brief: () => ({ result: null, mainEnemy: null }),
    positions: () => {},
  })
  await log.open()
  const [visit] = log.list()
  const records: LogRecord[] = []
  for await (const record of log.read(visit.id)) records.push(record)
  expect(records.filter((record) => record.kind === 'event').map((record) => record.sample.value.type)).toEqual(
    expect.arrayContaining(['damageAttributed', 'attributionRevision']),
  )
  const replayed = await replay(records)
  expect(replayed.map((summary) => displaySummary(summary, defaults.mergePets))).toEqual(live)

  // Potency samples are for the review only: the same visit with them recomputes the same summaries
  const potency = (at: number): LogRecord => ({
    kind: 'event',
    sample: sample(
      {
        type: 'potencySample',
        packet: effect(1).packet,
        data: {
          casterId: 1,
          targetId: 9,
          actionId: 10,
          sequence: 1,
          amount: 10000,
          potency: 200,
          multiplier: 1.06,
          factors: [{ statusId: 1878, sourceId: 5, holder: 'caster', value: 1.06 }],
        },
      },
      at,
    ),
  })
  const first = records.findIndex((record) => record.kind === 'event')
  const withSamples = [
    ...records.slice(0, first + 1),
    potency(T + 1000),
    potency(T + 1600),
    ...records.slice(first + 1),
  ]
  expect(await replay(withSamples)).toEqual(replayed)
})
it('replays an NPC party member as a member, but not from a log written before the sub kind was recorded', async () => {
  const h = await plugin(memoryStorage(), true)
  await h.zone(1263)
  await h.party([{ id: 1, ownParty: true }])
  await h.entities()
  await h.events([
    sample(effect(1, 100), T + 1000),
    sample(effect(2, 300, 4, 9), T + 1100),
    sample(effect(3, 30, 9, 4), T + 1200),
  ])
  h.at(T + 2000)
  await h.serviceRequest('endEncounter', { encounterId: h.current() })
  const live = (h.snapshot('statistics') as StatisticsState).selected!
  await h.dispose()
  expect(live.rows.find((row) => row.actor.id === 4)!.totals).toMatchObject({ damage: 300, taken: 30 })

  const log = new CombatLog(h.memory.storage, { values: {} } as unknown as Limits, {
    createdBy: 'test',
    actors: () => new Map(),
    names: { zone: () => null, job: () => null },
    brief: () => ({ result: null, mainEnemy: null }),
    positions: () => {},
  })
  await log.open()
  const records: LogRecord[] = []
  for await (const record of log.read(log.list()[0].id)) records.push(record)
  const [replayed] = await replay(records)
  expect(displaySummary(replayed, true)).toEqual(live)
  const old = records.map((record) =>
    record.kind === 'identities'
      ? { ...record, entities: record.entities.map(({ subKind: _, ...entity }) => entity) }
      : record,
  )
  const [before] = await replay(old)
  expect(before.rows.map((row) => row.actor.id)).toEqual([1])
})
it('replays heals on the caster and reflected damage into the same summary', async () => {
  const h = await plugin()
  await h.zone(1263)
  await h.party([{ id: 1, ownParty: true }])
  await h.entities()
  const withEffect = (event: GameEvent<'actionEffect'>, typeCode: number, rawFlags: number, rawValue: number) => {
    const [first] = event.data.targets[0].effects
    event.data.targets[0].effects.push({ ...first, effectIndex: 1, typeCode, rawFlags, rawValue })
    return event
  }
  await h.events([
    sample(withEffect(effect(1, 100), 4, 0x80, 2000), T + 1000),
    sample(withEffect(effect(2, 3000, 9, 1), 3, 0xa0, 433), T + 1100),
  ])
  h.at(T + 2000)
  await h.serviceRequest('endEncounter', { encounterId: h.current() })
  const live = (h.snapshot('statistics') as StatisticsState).selected!
  await h.dispose()
  const self = live.rows.find((row) => row.actor.id === 1)!
  expect(self.totals).toMatchObject({ damage: 533, healing: 2000, healingTaken: 2000, hits: 1 })
  expect(self.skills[REFLECT_SKILL].damage).toBe(433)

  const log = new CombatLog(h.memory.storage, { values: {} } as unknown as Limits, {
    createdBy: 'test',
    actors: () => new Map(),
    names: { zone: () => null, job: () => null },
    brief: () => ({ result: null, mainEnemy: null }),
    positions: () => {},
  })
  await log.open()
  const records: LogRecord[] = []
  for await (const record of log.read(log.list()[0].id)) records.push(record)
  const [replayed] = await replay(records)
  expect(displaySummary(replayed, true)).toEqual(live)
})
it('recomputes the visits of an earlier activation from the log when their fights are selected', async () => {
  const first = await plugin()
  await first.zone(1263)
  await first.party([{ id: 1, ownParty: true }])
  await first.entities()
  await first.events([sample(effect(1, 100), T + 1000)])
  first.at(T + 2000)
  await first.serviceRequest('endEncounter', { encounterId: first.current() })
  await first.events([sample(effect(2, 300), T + 3000)])
  first.at(T + 4000)
  await first.serviceRequest('endEncounter', { encounterId: first.current() })
  const older = (first.snapshot('statistics') as StatisticsState).selected!
  await first.zone(339)
  await first.events([sample(effect(3, 50), T + 5000)])
  first.at(T + 6000)
  await first.serviceRequest('endEncounter', { encounterId: first.current() })
  const newer = (first.snapshot('statistics') as StatisticsState).selected!
  await first.dispose()

  const failing = { read: false }
  const read = first.memory.storage.read
  first.memory.storage.read = (path) => (failing.read ? Promise.reject(new Error('读取失败')) : read(path))
  const second = await plugin(first.memory)
  const visits = () => (second.snapshot('visits') as VisitsState).visits
  const statistics = () => second.snapshot('statistics') as StatisticsState
  expect(visits().map((visit) => [visit.territoryType, visit.current, visit.status])).toEqual([
    [339, false, 'ok'],
    [1263, false, 'ok'],
  ])
  expect(visits()[1].fights.map((fight) => fight.result)).toEqual(['ended', 'ended'])
  // Opening the page shows the newest fight, which was recomputed while the activation started.
  expect(statistics()).toMatchObject({ following: true, loading: false, selected: newer })
  const select = () =>
    second.commands.get('statistics')!({ kind: 'select', visitId: visits()[1].id, fightId: visits()[1].fights[1].id })
  failing.read = true
  await select()
  expect(statistics()).toMatchObject({ following: false, loading: true, selected: null })
  // The recomputation was queued behind the command, so the next command runs after it.
  await second.commands.get('statistics')!({ kind: 'current' })
  expect(visits()[1]).toMatchObject({ status: 'failed', error: '读取失败' })
  failing.read = false
  await select()
  await select()
  expect(statistics()).toMatchObject({ loading: false, loadError: null, selected: older })
  expect(visits()[1].status).toBe('ok')
  await second.dispose()
})

it('finishes and hashes an active fight when the plugin is stopped, including its last buffered inputs', async () => {
  const h = await plugin()
  await h.zone(1263)
  await h.party([{ id: 1, ownParty: true }])
  await h.entities()
  h.at(T + 1000)
  await h.events([sample(effect(1, 100), T + 1000)])
  h.at(T + 1500)
  await h.dispose()
  const log = new CombatLog(h.memory.storage, { values: {} } as unknown as Limits, {
    createdBy: 'test',
    actors: () => new Map(),
    names: { zone: () => null, job: () => null },
    brief: () => ({ result: null, mainEnemy: null }),
    positions: () => {},
  })
  await log.open()
  const visit = log.list()[0]
  const records: LogRecord[] = []
  for await (const record of log.read(visit.id)) records.push(record)
  const summaries = await replay(records)
  expect(summaries).toHaveLength(1)
  expect(summaries[0].reason).toBe('stopped')
  expect(log.list()[0].integrity).toBe('verified')
})
it('replays a fight ended for an unavailable input into the same summary as the live statistics', async () => {
  const h = await plugin()
  await h.zone(1263)
  await h.party([{ id: 1, ownParty: true }])
  await h.entities()
  h.at(T + 1000)
  await h.events([sample(effect(1, 100), T + 1000)])
  h.at(T + 2000)
  h.setReadsFail(true)
  await h.events([sample(effect(2, 50), T + 2000)])
  expect(h.snapshot('statistics')).toMatchObject({ paused: true })
  const [visit] = (h.snapshot('visits') as VisitsState).visits
  await h.commands.get('statistics')!({ kind: 'select', visitId: visit.id, fightId: visit.fights[0].id })
  const live = (h.snapshot('statistics') as StatisticsState).selected!
  expect(live).toMatchObject({ reason: 'inputUnavailable', encounterDamage: { value: 100 } })
  await h.dispose()
  const log = new CombatLog(h.memory.storage, { values: {} } as unknown as Limits, {
    createdBy: 'test',
    actors: () => new Map(),
    names: { zone: () => null, job: () => null },
    brief: () => ({ result: null, mainEnemy: null }),
    positions: () => {},
  })
  await log.open()
  const records: LogRecord[] = []
  for await (const record of log.read(log.list()[0].id)) records.push(record)
  const replayed = await replay(records)
  expect(replayed.map((summary) => displaySummary(summary, true))).toEqual([live])
})
