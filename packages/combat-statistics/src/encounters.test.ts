import { expect, it, vi } from 'vitest'
import type { AttributionDelta, DamageAttribution, GameEvent } from './combat-events.js'
import { type ChangedEncounter, Encounters } from './encounters.js'
import { actors, attribution, combat, effect, sample, tick } from './fixtures.js'
import { Ledger } from './ledger.js'
import type { Summary } from './model.js'

const setup = () => {
  let id = 0
  const changed: Summary[] = []
  const encounters = new Encounters(
    () => `battle-${++id}`,
    // As each change saw it
    (encounter) => changed.push(encounter.summary()),
  )
  encounters.updateActors(actors())
  encounters.localActorId = 1
  return { encounters, changed }
}
it('ignores city healing, opens on miss, and ends on source silence without counting wait time', () => {
  const { encounters } = setup()
  encounters.accept(sample(effect(1, 100, 2, 1, 4), 0), 0)
  expect(encounters.active).toBeNull()
  encounters.accept(sample(effect(2, 0, 1, 9, 1), 1000), 1000)
  encounters.accept(sample(effect(3, 500, 2, 1, 4), 5000), 5000)
  expect(encounters.deadline()).toBe(11001)
  encounters.advance(11001)
  expect(encounters.snapshot(encounters.completed[0])).toMatchObject({ startAt: 1000, endAt: 5000, reason: 'quiet' })
})
it('splits new activity before applying it even if the timer has not run', () => {
  const { encounters } = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample(effect(2), 12000), 12000)
  expect(encounters.completed).toHaveLength(1)
  expect(encounters.snapshot()?.encounterDamage.value).toBe(100)
  expect(encounters.end('battle-1', 13000)).toBe('staleEncounter')
  expect(encounters.end('battle-2', 13000)).toBe('ended')
  expect(encounters.end('battle-2', 13000)).toBe('alreadyEnded')
})
it('keeps delayed ticks and post revisions in the original encounter and cannot resurrect cleared history', () => {
  const { encounters } = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.end('battle-1', 2100)
  encounters.accept(sample(effect(2), 3000), 3000)
  encounters.accept(sample({ type: 'periodicTick', data: tick() }, 3200), 3200)
  expect(encounters.snapshot(encounters.completed[0])?.encounterDamage.value).toBe(150)
  expect(encounters.snapshot()?.encounterDamage.value).toBe(100)
  encounters.accept(
    sample(
      {
        type: 'periodicRevision',
        data: {
          estimatorGeneration: 1,
          ticks: [tick({ phase: 'post', shares: [{ sourceId: 1, statusId: 1, amount: 90, basis: 'exact' }] })],
        },
      },
      3300,
    ),
    3300,
  )
  expect(encounters.snapshot(encounters.completed[0])?.encounterDamage.value).toBe(190)
  encounters.clearHistory()
  encounters.accept(
    sample({ type: 'periodicRevision', data: { estimatorGeneration: 1, ticks: [tick({ phase: 'post' })] } }, 3400),
    3400,
  )
  expect(encounters.completed).toHaveLength(0)
})
it('manual mode survives a long transition while a source boundary marks incomplete and seals pending work', () => {
  const { encounters } = setup()
  encounters.config.mode = 'manual'
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.advance(100000)
  expect(encounters.active).not.toBeNull()
  encounters.boundary('overflow', 100000)
  expect(encounters.snapshot(encounters.completed[0])?.quality).toContain('输入不完整：overflow')
  expect(encounters.active).toBeNull()
})

it('uses packet elapsed time for DPS while keeping delivery-clock quiet deadlines', () => {
  const encounters = new Encounters(
    () => 'timing',
    () => {},
  )
  encounters.updateActors(actors())
  const first = sample(effect(1, 100), 1255.1333)
  first.value.packet.timestamp = 1214
  const last = sample(effect(2, 200), 31070.6716)
  last.value.packet.timestamp = 31011
  encounters.config.quietSeconds = 120
  encounters.accept(first, first.meta.observedAt)
  encounters.accept(last, last.meta.observedAt)
  const summary = encounters.snapshot()!
  expect(summary.durationMs).toBe(29797)
  expect(summary.endAt - summary.startAt).toBeCloseTo(29815.5383)
  expect(summary.rows[0].metrics.encDps.value).toBeCloseTo(300 / 29.797)
  expect(encounters.deadline()).toBeCloseTo(151071.6716)
})

it('closes immediately on false without inflating fact duration and retains a 45ms pulse', () => {
  const { encounters, changed } = setup()
  encounters.accept(sample(combat(1, true), 0), 0)
  expect(encounters.active).toBeNull()
  encounters.accept(sample(effect(2), 1000), 1000)
  encounters.accept(sample(effect(3), 2000), 2000)
  encounters.accept(sample(combat(4, false), 3000), 3000)
  expect(encounters.active).toBeNull()
  expect(changed.at(-1)).toMatchObject({
    id: 'battle-1',
    ended: true,
    reason: 'outOfCombat',
    durationMs: 1000,
    endAt: 2000,
  })
  encounters.accept(sample(combat(5, true), 3045), 3045)
  expect(encounters.active).toBeNull()
  encounters.accept(sample(effect(6), 3050), 3050)
  expect(encounters.snapshot()).toMatchObject({ id: 'battle-2', encounterDamage: { value: 100 } })
  expect(encounters.completed).toHaveLength(1)
})
it('preserves known true across long silence and invalidation uses the original elapsed deadline', () => {
  const { encounters } = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample(combat(2, true), 2000), 2000)
  expect(encounters.deadline()).toBeNull()
  encounters.advance(100000)
  expect(encounters.active).not.toBeNull()
  encounters.syncCombat(false, 3000, 100000) // a snapshot cannot replace ordered state
  expect(encounters.inCombat).toBe(true)
  encounters.syncCombat(null, 100000, 100000)
  expect(encounters.snapshot(encounters.completed[0])).toMatchObject({ reason: 'quiet', durationMs: 0 })
})
it('initial false does not swallow the first transition and same-timestamp subsequent facts can reopen', () => {
  const { encounters } = setup()
  encounters.syncCombat(false, 1000, 1000)
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample(combat(2, false), 1000), 1000)
  encounters.accept(sample(effect(3, 200), 1000), 1000)
  encounters.accept(sample(combat(2, false), 1000), 1000) // repeated old position
  encounters.accept(sample(combat(4, false), 1000), 1000) // repeated value
  encounters.accept(sample(combat(5, false, 9), 1000), 1000)
  expect(encounters.completed).toHaveLength(1)
  expect(encounters.snapshot()).toMatchObject({ id: 'battle-2', encounterDamage: { value: 200 } })
  expect(encounters.deadline()).toBe(11001)
  encounters.accept(sample(combat(6, true), 1000), 1000)
  encounters.accept(sample(combat(7, false), 1000), 1000)
  expect(encounters.completed).toHaveLength(2)
})
it('manual mode ignores false, switching to auto does not replay it, and future transitions work', () => {
  const { encounters } = setup()
  encounters.config.mode = 'manual'
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample(combat(2, false), 2000), 2000)
  encounters.advance(100000)
  expect(encounters.deadline()).toBeNull()
  encounters.config.mode = 'auto'
  encounters.accept(sample(combat(3, false), 3000), 3000)
  expect(encounters.active).not.toBeNull()
  encounters.accept(sample(combat(4, true), 3000), 3000)
  encounters.advance(100000)
  expect(encounters.active).not.toBeNull()
  encounters.accept(sample(combat(5, false), 100001), 100001)
  expect(encounters.completed).toHaveLength(1)
  encounters.advance(200000)
  expect(encounters.end('battle-1', 200001)).toBe('alreadyEnded')
})
it('rejects stale positions and snapshots and clears combat memory on input boundaries', () => {
  const { encounters } = setup()
  encounters.accept(sample(combat(10, true), 1000), 1000)
  encounters.accept(sample(effect(12), 2000), 2000)
  encounters.accept(sample(combat(11, false), 2000), 2000)
  encounters.syncCombat(null, 999, 3000)
  expect(encounters.inCombat).toBe(true)
  encounters.boundary('overflow', 3000)
  expect(encounters.inCombat).toBeNull()
  encounters.syncCombat(true, 2500, 3000)
  expect(encounters.inCombat).toBeNull()
  encounters.updateActors(actors())
  encounters.accept(sample(effect(13), 4000), 4000)
  expect(encounters.deadline()).toBe(14001)
  encounters.accept(sample(combat(14, false), 4500), 4500)
  expect(encounters.completed).toHaveLength(2)
})
it('predicts whether a snapshot changes the combat state', () => {
  const { encounters } = setup()
  const state = () => {
    const { inCombat, combatValue } = encounters.carry()
    return JSON.stringify({ inCombat, combatValue })
  }
  const sync = (value: boolean | null, at: number) => {
    const before = state()
    const predicted = encounters.syncChanges(value, at)
    encounters.syncCombat(value, at, at)
    expect(predicted).toBe(state() !== before)
    return predicted
  }
  expect(sync(false, 1000)).toBe(true)
  expect(sync(false, 2000)).toBe(false) // already synced
  expect(sync(true, 1500)).toBe(false) // older than the last snapshot
  encounters.resetCombat(3000)
  expect(sync(false, 3000)).toBe(false) // not after the reset
  expect(sync(false, 3001)).toBe(true) // the same value after a reset
  encounters.accept(sample(combat(1, true), 4000), 4000)
  expect(sync(false, 4000)).toBe(false) // not after the ordered fact
  expect(sync(false, 5000)).toBe(false) // ordered state wins over a snapshot value
  expect(sync(null, 6000)).toBe(true) // null clears the ordered value
  expect(encounters.carry().combatValue).toBeNull()
})
it('keeps periodic bindings in old history, drops an unbound false tail and accepts a new active tick', () => {
  const { encounters } = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample({ type: 'periodicTick', data: tick() }, 2000), 2000)
  encounters.accept(sample(combat(2, false), 2500), 2500)
  encounters.accept(sample({ type: 'periodicTick', data: tick({ tickId: 2, occurredAt: 2600 }) }, 2700), 2700)
  expect(encounters.active).toBeNull()
  expect(encounters.qualityReasons.size).toBe(0)
  encounters.accept(sample(effect(3), 3000), 3000)
  encounters.accept(
    sample(
      {
        type: 'periodicRevision',
        data: {
          estimatorGeneration: 1,
          ticks: [tick({ phase: 'post', shares: [{ sourceId: 1, statusId: 1, amount: 90, basis: 'exact' }] })],
        },
      },
      3100,
    ),
    3100,
  )
  expect(encounters.snapshot(encounters.completed[0])?.encounterDamage.value).toBe(190)
  encounters.accept(sample({ type: 'periodicTick', data: tick({ tickId: 3, occurredAt: 3050 }) }, 3200), 3200)
  expect(encounters.snapshot()?.encounterDamage.value).toBe(150)
  encounters.accept(sample({ type: 'periodicTick', data: tick({ tickId: 4, occurredAt: 2500 }) }, 3300), 3300)
  expect(encounters.qualityReasons.size).toBe(0)
  expect(encounters.snapshot(encounters.completed[0])?.encounterDamage.value).toBe(190)
})
it('late unbound ticks inside an unambiguous closed window revise only that history', () => {
  const { encounters, changed } = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample(combat(2, false), 2500), 2500)
  encounters.accept(sample({ type: 'periodicTick', data: tick() }, 3000), 3000)
  expect(encounters.active).toBeNull()
  expect(encounters.completed).toHaveLength(1)
  expect(changed.at(-1)).toMatchObject({ id: 'battle-1', ended: true, encounterDamage: { value: 150 } })
})
it('true/false without facts never creates history and repeated display sampling cannot change final facts', () => {
  const run = (reads: number) => {
    const { encounters } = setup()
    encounters.accept(sample(combat(1, true), 0), 0)
    encounters.accept(sample(combat(2, false), 45), 45)
    expect(encounters.completed).toHaveLength(0)
    encounters.accept(sample(effect(3), 1000), 1000)
    encounters.accept(sample(effect(4), 2000), 2000)
    for (let i = 0; i < reads; i++) encounters.snapshot()
    encounters.accept(sample(combat(5, true), 2000), 2000)
    encounters.accept(sample(combat(6, false), 3000), 3000)
    return JSON.stringify(encounters.snapshot(encounters.completed[0]))
  }
  expect(run(0)).toBe(run(100))
})

it('separates incoming activity and closure from qualified settlement endpoints', () => {
  const { encounters } = setup()
  encounters.accept(sample(effect(1, 10, 9, 1), 100), 100)
  expect(encounters.snapshot()).toMatchObject({ durationMs: 0, encounterDamage: { value: 0 } })
  expect(encounters.presentationAnchor()).toBeNull()
  encounters.accept(sample(effect(2, 100), 1000), 1000)
  encounters.accept(sample(effect(3, 200), 2000), 2000)
  const incoming = sample(effect(4, 20, 9, 1), 3000)
  incoming.value.packet.timestamp = NaN
  encounters.accept(incoming, 3000)
  expect(encounters.deadline()).toBe(13001)
  expect(encounters.presentationAnchor()).toMatchObject({ factDurationMs: 1000, lastFactSourceAt: 2000 })
  encounters.accept(sample(combat(5, false), 4000), 4000)
  const final = encounters.snapshot(encounters.completed[0])!
  expect(final).toMatchObject({ startAt: 1000, endAt: 2000, durationMs: 1000, reason: 'outOfCombat' })
  expect(final.rows[0].totals).toMatchObject({ damage: 300, taken: 30 })
  expect(final.rows[0].metrics.dps.value).toBe(300)
  expect(final.rows[0].metrics.encDps.value).toBe(300)
})
it('counts incoming periodic damage without creating a settlement or projection clock', () => {
  const { encounters } = setup()
  encounters.accept(sample(effect(1, 10, 9, 1), 1000), 1000)
  encounters.accept(
    sample(
      {
        type: 'periodicTick',
        data: tick({
          target: 1,
          unknown: 0,
          statusId: 5,
          shares: [{ sourceId: 9, statusId: 5, amount: 100, basis: 'exact' }],
        }),
      },
      2000,
    ),
    2000,
  )
  const facts = encounters.snapshot()!
  expect(facts.durationMs).toBe(0)
  expect(facts.rows[0].totals.taken).toBe(110)
  expect(facts.rows[0].metrics.encDps.value).toBeNull()
  expect(encounters.presentationAnchor()).toBeNull()
})
it('keeps a delayed periodic revision on the lifecycle owner after incoming-only tail activity', () => {
  const { encounters } = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample(effect(2, 10, 9, 1), 3000), 3000)
  encounters.end('battle-1', 4000)
  encounters.accept(sample(effect(3), 5000), 5000)
  const pending = tick({
    occurredAt: 3500,
    unknown: 0,
    shares: [{ sourceId: 1, statusId: 1, amount: 100, basis: 'estimated' }],
  })
  encounters.accept(sample({ type: 'periodicTick', data: pending }, 6000), 6000)
  expect(encounters.snapshot(encounters.completed[0])?.endAt).toBe(3500)
  encounters.accept(
    sample(
      {
        type: 'periodicRevision',
        data: { estimatorGeneration: 1, ticks: [{ ...pending, phase: 'post', unknown: 100, shares: [] }] },
      },
      7000,
    ),
    7000,
  )
  expect(encounters.snapshot(encounters.completed[0])).toMatchObject({ startAt: 1000, endAt: 1000, durationMs: 0 })
  expect(encounters.snapshot()).toMatchObject({ id: 'battle-2', startAt: 5000, endAt: 5000 })
})

const hp = (seq: number, actorId: number, hpCur: number, hpMax: number | null, sequence: number | null) => ({
  type: 'hpChanged' as const,
  packet: { seq, timestamp: seq, sourceActorId: actorId, targetActorId: actorId },
  data: { origin: 'effectResult' as const, actorId, hpCur, hpMax, sequence },
})
const heal = (seq: number, amount: number, sequence: number) => {
  const event = effect(seq, amount, 2, 1, 4)
  event.data.sequence = sequence
  return event
}
const healer = (encounters: Encounters, encounter = encounters.active) =>
  encounters.snapshot(encounter)!.rows.find((row) => row.actor.id === 2)!
it('measures a heal against the HP its target had before the EffectResult', () => {
  const { encounters } = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample(hp(2, 1, 5000, 10000, 7), 1100), 1100)
  encounters.accept(sample(heal(3, 8000, 8), 1200), 1200)
  encounters.accept(sample(hp(4, 1, 10000, 10000, 8), 1300), 1300)
  expect(healer(encounters).totals).toMatchObject({ healing: 8000, overhealed: 3000, unmeasuredHealing: 0 })
  expect(healer(encounters).metrics.overheal).toMatchObject({ value: 3000, quality: 'estimated' })
})
it('settles the heals of an encounter that ended quietly before the EffectResult arrived', () => {
  const { encounters, changed } = setup()
  encounters.accept(sample(hp(1, 1, 5000, 10000, null), 900), 900)
  encounters.accept(sample(effect(2), 1000), 1000)
  encounters.accept(sample(heal(3, 8000, 8), 2000), 2000)
  encounters.advance(11001)
  expect(encounters.active).toBeNull()
  const before = changed.length
  encounters.accept(sample(hp(4, 1, 10000, null, 8), 2100), 11001)
  expect(changed).toHaveLength(before + 1)
  expect(healer(encounters, encounters.completed[0]).totals.overhealed).toBe(3000)
})
it('opens no encounter for HP alone', () => {
  const { encounters, changed } = setup()
  encounters.accept(sample(hp(1, 1, 5000, 10000, 7), 1000), 1000)
  encounters.accept(sample(hp(2, 9, 5000, 10000, null), 1100), 1100)
  expect(encounters.active).toBeNull()
  expect(changed).toHaveLength(0)
})
it('forgets the HP of another source', () => {
  const { encounters } = setup()
  encounters.accept(sample(hp(1, 1, 5000, 10000, 7), 1000), 1000)
  const other = <T extends GameEvent>(value: T, at: number) => {
    const item = sample(value, at)
    return { ...item, meta: { ...item.meta, sessionId: 'other' } }
  }
  encounters.accept(other(hp(2, 9, 1, 10, null), 1100), 1100)
  encounters.updateActors(actors())
  encounters.accept(other(effect(3), 1200), 1200)
  encounters.accept(other(heal(4, 8000, 8), 1300), 1300)
  encounters.accept(other(hp(5, 1, 10000, null, 8), 1400), 1400)
  expect(healer(encounters).totals).toMatchObject({ overhealed: 0, unmeasuredHealing: 8000 })
})
it('uses the HP before an UpdateHpMpTp that arrived with the HoT tick', () => {
  const { encounters } = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample(hp(2, 1, 9000, 10000, 7), 1500), 1500)
  encounters.accept(sample(hp(3, 1, 10000, null, null), 2000), 2000)
  const hot = tick({
    target: 1,
    isHeal: true,
    total: 1000,
    unknown: 0,
    shares: [{ sourceId: 2, statusId: 158, amount: 1000, basis: 'estimated' }],
  })
  encounters.accept(sample({ type: 'periodicTick', packet: hp(4, 1, 0, null, null).packet, data: hot }, 2000), 2000)
  expect(healer(encounters).totals).toMatchObject({ healing: 1000, overhealed: 0, unmeasuredHealing: 0 })
})
it('measures a heal without EffectResult against the target HP when it arrived', () => {
  const { encounters } = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample(hp(2, 1, 10000, 10000, null), 1100), 1100)
  encounters.accept(sample(heal(3, 8000, 8), 1200), 1200)
  encounters.accept(sample(effect(4), 6201), 6201)
  expect(healer(encounters).totals).toMatchObject({ healing: 8000, overhealed: 8000, unmeasuredHealing: 0 })
})
it('reports fight starts and ends to the hooks in order', () => {
  const calls: unknown[] = []
  let id = 0
  const encounters = new Encounters(
    () => `battle-${++id}`,
    () => {},
    {
      started: (info) => calls.push(['started', info]),
      ended: ({ summary, ...info }) => calls.push(['ended', info, summary.id, summary.ended]),
    },
  )
  encounters.updateActors(actors())
  encounters.localActorId = 1
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample(effect(2), 12000), 12000)
  encounters.end('battle-2', 13000)
  encounters.config = { ...encounters.config, mode: 'auto' }
  encounters.accept(sample(effect(3), 14000), 14000)
  encounters.accept(sample(combat(4, true), 14100), 14100)
  encounters.accept(sample(combat(5, false), 14200), 14200)
  encounters.accept(sample(effect(6), 15000), 15000)
  encounters.accept(
    sample({ type: 'zoneChanged', packet: effect(7).packet, data: { territoryTypeId: 2 } }, 16000),
    16000,
  )
  // The source clock is past the quiet deadline once this event has been applied.
  encounters.accept(sample(effect(8), 17000), 40000)
  expect(calls).toEqual([
    ['started', { id: 'battle-1', at: 1000 }],
    ['ended', { id: 'battle-1', reason: 'quiet', at: 11000, afterInput: false }, 'battle-1', true],
    ['started', { id: 'battle-2', at: 12000 }],
    ['ended', { id: 'battle-2', reason: 'manual', at: 13000, afterInput: false }, 'battle-2', true],
    ['started', { id: 'battle-3', at: 14000 }],
    ['ended', { id: 'battle-3', reason: 'outOfCombat', at: 14200, afterInput: false }, 'battle-3', true],
    ['started', { id: 'battle-4', at: 15000 }],
    ['ended', { id: 'battle-4', reason: 'zoneChanged', at: 16000, afterInput: false }, 'battle-4', true],
    ['started', { id: 'battle-5', at: 17000 }],
    ['ended', { id: 'battle-5', reason: 'quiet', at: 27000, afterInput: true }, 'battle-5', true],
  ])
})
it('carries combat state into a new instance that then produces the same summary', () => {
  const run = (encounters: Encounters) => {
    encounters.accept(sample(effect(10), 5000), 5000)
    encounters.accept(sample(combat(11, false), 5100), 5100)
    encounters.accept(sample(effect(12), 6000), 6000)
    return encounters.snapshot()
  }
  const first = setup().encounters
  first.accept(sample(combat(2, true), 900), 900)
  first.accept(sample(effect(3), 1000), 1000)
  first.accept(sample(combat(4, false), 1200), 1200)
  const carry = JSON.parse(JSON.stringify(first.carry()))
  const second = setup().encounters
  second.localActorId = null
  second.restore(carry)
  expect(second.carry()).toEqual(first.carry())
  expect(run(second)).toEqual({ ...run(first), id: expect.any(String) })
})

const attributed = (seq: number | null, data: Partial<DamageAttribution>): GameEvent<'damageAttributed'> => ({
  type: 'damageAttributed',
  ...(seq === null ? {} : { packet: effect(seq).packet }),
  data: attribution(data),
})
const revised = (records: AttributionDelta[]): GameEvent<'attributionRevision'> => ({
  type: 'attributionRevision',
  data: { estimatorGeneration: 1, records },
})
const delta = (patch: Partial<AttributionDelta>): AttributionDelta => ({
  id: 1,
  tickId: null,
  actorId: 2,
  origin: { type: 'action', actionId: 10 },
  contributions: [{ statusId: 786, sourceId: 1, amount: 100 }],
  ...patch,
})
/** The contribution of each skill of each row */
const contributions = (summary: Summary | null) =>
  Object.fromEntries(
    (summary?.rows ?? []).map((row) => [
      row.actor.id,
      Object.fromEntries(Object.entries(row.skills).map(([id, skill]) => [id, skill.contribution])),
    ]),
  )
it('adjusts the encounter that took the damage of a split, and revises an ended one by the ids of its splits', () => {
  const { encounters } = setup()
  const revisions: boolean[] = []
  const tracked = new Encounters(
    () => `battle-${revisions.length}`,
    (_, revision) => revisions.push(revision),
  )
  for (const target of [encounters, tracked]) {
    target.updateActors(actors())
    target.localActorId = 1
  }
  for (const item of [encounters, tracked]) {
    item.accept(sample(effect(1, 10000, 2), 1000), 1000)
    item.accept(sample(attributed(1, {}), 1000), 1000)
    item.end(item.active!.id, 2100)
    item.accept(sample(effect(2), 3000), 3000)
    // A summed tick of the first encounter, and the split of its share of member 1
    item.accept(sample({ type: 'periodicTick', data: tick() }, 3200), 3200)
    item.accept(
      sample(
        attributed(null, {
          id: 2,
          origin: { type: 'tick', tickId: 1, statusId: 1 },
          attackerId: 1,
          actorId: 1,
          amount: 50,
          contributions: [{ statusId: 786, sourceId: 2, amount: 5 }],
        }),
        3200,
      ),
      3200,
    )
  }
  const first = encounters.completed[0]
  expect(contributions(encounters.snapshot(first))).toEqual({
    1: { 'status:786': 600, 'status:1': 45 },
    2: { 'action:10': 9400, 'status:786': 5 },
  })
  expect(contributions(encounters.snapshot())).toEqual({ 1: { 'action:10': 100 } })

  revisions.length = 0
  for (const item of [encounters, tracked])
    item.accept(
      sample(
        revised([
          delta({}),
          delta({ id: null, tickId: 1, actorId: 1, origin: { type: 'tick', statusId: 1 }, contributions: [] }),
          // Neither split was taken by an encounter
          delta({ id: 3 }),
          delta({ id: null, tickId: 2 }),
        ]),
        3300,
      ),
      3300,
    )
  expect(revisions).toEqual([true])
  expect(contributions(encounters.snapshot(first))).toEqual({
    1: { 'status:786': 700, 'status:1': 45 },
    2: { 'action:10': 9300, 'status:786': 5 },
  })
  expect(encounters.snapshot(first)?.diagnostics.unmatchedAttributions).toBe(0)
})
it('finds the encounter of a summed tick delta before the periodic revision lets the tick go', () => {
  const { encounters } = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample({ type: 'periodicTick', data: tick() }, 2000), 2000)
  const shareDelta = delta({
    id: null,
    tickId: 1,
    actorId: 1,
    origin: { type: 'tick', statusId: 1 },
    contributions: [{ statusId: 786, sourceId: 2, amount: 10 }],
  })
  encounters.accept(sample(revised([shareDelta]), 2100), 2100)
  expect(contributions(encounters.snapshot())).toEqual({
    1: { 'action:10': 100, 'status:1': 40 },
    2: { 'status:786': 10 },
  })
  encounters.accept(
    sample({ type: 'periodicRevision', data: { estimatorGeneration: 1, ticks: [tick({ phase: 'post' })] } }, 2200),
    2200,
  )
  encounters.accept(sample(revised([shareDelta]), 2300), 2300)
  expect(contributions(encounters.snapshot())[2]).toEqual({ 'status:786': 10 })
})
it('ignores the deltas of history that was cleared', () => {
  const { encounters, changed } = setup()
  encounters.accept(sample(effect(1, 10000, 2), 1000), 1000)
  encounters.accept(sample(attributed(1, {}), 1000), 1000)
  encounters.end('battle-1', 2000)
  encounters.clearHistory()
  const before = changed.length
  encounters.accept(sample(revised([delta({})]), 3000), 3000)
  expect(changed).toHaveLength(before)
})
it('drops the splits of a limit break that older logs have', () => {
  const { encounters } = setup()
  const braver = effect(1, 10000, 2)
  braver.data.actionId = 200
  encounters.accept(sample(braver, 1000), 1000)
  encounters.accept(sample(attributed(1, { origin: { type: 'action', actionId: 200, sequence: 42 } }), 1000), 1000)
  const before = contributions(encounters.snapshot())
  expect(before).toEqual({ 0: { 'action:200@source:1:2': 10000 } })
  encounters.accept(sample(revised([delta({ origin: { type: 'action', actionId: 200 } })]), 1100), 1100)
  expect(contributions(encounters.snapshot())).toEqual(before)
  expect(encounters.snapshot()?.diagnostics.unmatchedAttributions).toBe(0)
})
it('shares a summary until the encounters change', () => {
  const { encounters } = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  const first = encounters.snapshot(undefined, false)
  expect(encounters.snapshot(undefined, false)).toBe(first)
  expect(encounters.snapshot(undefined, true)).not.toBe(first)
  encounters.accept(sample(effect(2), 2000), 2000)
  const second = encounters.snapshot(undefined, false)
  expect(second).not.toBe(first)
  expect(first?.encounterDamage.value).toBe(100)
  expect(second?.encounterDamage.value).toBe(200)
})
it('computes the summary of a change only when it is read', () => {
  let id = 0
  const changes: ChangedEncounter[] = []
  const encounters = new Encounters(
    () => `battle-${++id}`,
    (encounter) => changes.push(encounter),
  )
  encounters.updateActors(actors())
  encounters.localActorId = 1
  const summarize = vi.spyOn(Ledger.prototype, 'summary')
  try {
    for (let index = 0; index < 5; index++) encounters.accept(sample(effect(index + 1), 1000 + index), 1000 + index)
    expect(changes).toHaveLength(5)
    expect(summarize).not.toHaveBeenCalled()
    expect(changes[0].summary().encounterDamage.value).toBe(500)
    expect(changes.at(-1)!.summary()).toBe(changes[0].summary())
    expect(summarize).toHaveBeenCalledOnce()
  } finally {
    summarize.mockRestore()
  }
})
it('refreshes the ledger only when the actors or the active encounter changed', () => {
  const { encounters } = setup()
  encounters.updateActors(actors(), 1)
  encounters.accept(sample(effect(1), 1000), 1000)
  const refresh = vi.spyOn(Ledger.prototype, 'refresh')
  try {
    encounters.updateActors(actors(), 1)
    expect(refresh).toHaveBeenCalledOnce()
    encounters.updateActors(actors(), 1)
    expect(refresh).toHaveBeenCalledOnce()
    encounters.updateActors(actors(), 2)
    expect(refresh).toHaveBeenCalledTimes(2)
    encounters.end('battle-1', 2000)
    encounters.accept(sample(effect(2), 3000), 3000)
    encounters.updateActors(actors(), 2)
    expect(refresh).toHaveBeenCalledTimes(3)
    encounters.updateActors(actors())
    expect(refresh).toHaveBeenCalledTimes(4)
  } finally {
    refresh.mockRestore()
  }
})
it('counts a summed tick on a member only within a fight', () => {
  const { encounters } = setup()
  const summed = { target: 1, unknown: 100, shares: [] }
  encounters.accept(sample({ type: 'periodicTick', data: tick(summed) }, 1000), 1000)
  expect(encounters.active).toBeNull()
  encounters.accept(sample(effect(1), 2000), 2000)
  encounters.accept(
    sample({ type: 'periodicTick', data: tick({ ...summed, tickId: 2, occurredAt: 2500 }) }, 2500),
    2500,
  )
  const summary = encounters.snapshot()!
  expect(summary.rows.find((row) => row.actor.id === 1)?.totals.taken).toBe(100)
  expect(summary.diagnostics.unassignedObservedDamage).toBe(0)
})
