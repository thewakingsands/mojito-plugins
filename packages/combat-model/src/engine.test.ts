import { describe, expect, it } from 'vitest'
import { periodicDefs } from './defs/index.js'
import { CombatEngine } from './engine.js'
import type { CombatInput } from './input.js'
import type { CombatOutput } from './output.js'
import { ASTROLOGIAN, ENEMY, SAGE, SAMURAI, testCombatants, testDefs } from './testing/periodic.js'
import { AbilityEffectSeverity, apply, COMBUST, damage, effectTarget } from './testing/periodic-harness.js'
import { MemoryWorld } from './world.js'

const hit = (time: number, value: number, severity = AbilityEffectSeverity.Normal): CombatInput => ({
  type: 'effect',
  time,
  caster: SAMURAI,
  action: 7477,
  sequence: 1,
  targets: [effectTarget(ENEMY, 0, [damage(value, severity)])],
})

const summed = (time: number, target = ENEMY): CombatInput => ({
  type: 'tick',
  time,
  target,
  isHeal: false,
  status: 0,
  amount: 500,
  source: null,
})

const types = (outputs: CombatOutput[]) => outputs.map((output) => output.type)

/** A world with the players and the enemy of the tests, as actor inputs give it */
function world(): MemoryWorld {
  const result = new MemoryWorld()
  for (const [id, classJob, level] of [
    [ASTROLOGIAN, 33, 100],
    [SAMURAI, 34, 100],
    [SAGE, 40, 100],
    [ENEMY, 0, 100],
  ])
    result.handle({ type: 'actor', time: 0, actorId: id, classJob, level, ownerId: null })
  return result
}

describe('CombatEngine', () => {
  it('hands a potency sample on after the ticks of the effect and before its split', () => {
    const engine = new CombatEngine(testDefs(), world())
    // The summed tick has no statuses, so nothing splits it; it expires when the hit comes
    engine.handle(summed(1000))
    const output = engine.handle(hit(1200, 3000))
    expect(types(output)).toEqual(['periodicTick', 'potencySample', 'damageAttributed'])
    expect(output[0]).toMatchObject({ data: { tickId: 1, occurredAt: 1000, target: ENEMY, total: 500, unknown: 500 } })
    expect(output[1]).toMatchObject({
      data: { casterId: SAMURAI, targetId: ENEMY, actionId: 7477, amount: 3000, potency: 200 },
    })
  })

  it('splits the damage of a tick of its own status after the tick', () => {
    const engine = new CombatEngine(testDefs(), world())
    const output = engine.handle({
      type: 'tick',
      time: 1000,
      target: ENEMY,
      isHeal: false,
      status: 749,
      amount: 500,
      source: SAMURAI,
    })
    expect(types(output)).toEqual(['periodicTick', 'damageAttributed'])
    expect(output[1]).toMatchObject({
      data: { origin: { type: 'tick', tickId: 1, statusId: 749 }, attackerId: SAMURAI, amount: 500 },
    })
  })

  it('expires only ticks beyond 100ms and closes the last window once after ten quiet seconds', () => {
    const engine = new CombatEngine(testDefs(), world())
    expect(engine.handle(summed(1000))).toEqual([])
    expect(engine.nextDeadline()).toBe(1101)
    expect(engine.drain(1099)).toEqual([])
    expect(engine.drain(1100)).toEqual([])
    expect(engine.handle(summed(1050, SAGE))).toEqual([])
    expect(engine.drain(1101)).toMatchObject([{ type: 'periodicTick', data: { tickId: 1, occurredAt: 1000 } }])
    expect(engine.nextDeadline()).toBe(1151)
    expect(engine.drain(1151)).toMatchObject([{ type: 'periodicTick', data: { tickId: 2, occurredAt: 1050 } }])
    expect(engine.drain(11050)).toEqual([])
    expect(engine.drain(11051)).toMatchObject([
      { type: 'periodicRevision', data: { ticks: [{ tickId: 1, phase: 'post' }, { tickId: 2 }] } },
    ])
    expect(engine.drain(20000)).toEqual([])
    expect(engine.nextDeadline()).toBeNull()
  })

  it('closes the window and the pending ticks on zone change', () => {
    const engine = new CombatEngine(testDefs(), world())
    engine.handle(summed(1000))
    expect(types(engine.handle({ type: 'zone', time: 1001, territory: 1, receiver: SAGE }))).toEqual([
      'periodicTick',
      'periodicRevision',
    ])
    expect(engine.nextDeadline()).toBeNull()
  })

  it('keeps the window open with a cast', () => {
    const engine = new CombatEngine(testDefs(), world())
    engine.handle(hit(1000, 3000))
    engine.handle({ type: 'cast', time: 9000, caster: ENEMY, action: 1 })
    expect(engine.nextDeadline()).toBe(19001)
    expect(engine.drain(15000)).toEqual([])
  })

  it('splits each hit after it, and ends a window with the deltas before the revision', () => {
    const engine = new CombatEngine(testDefs(), world())
    expect(types(engine.handle(hit(1000, 3000)))).toEqual(['potencySample', 'damageAttributed'])
    // Battle Litany of the sage on the samurai, and a critical hit under it
    engine.handle({
      type: 'statuses',
      time: 1050,
      holder: SAMURAI,
      slots: [{ slot: 0, status: { id: 786, source: SAGE, stacks: 0 } }],
      changes: [{ kind: 'gained', slot: 0, status: 786, source: SAGE }],
    })
    const [sample, split] = engine.handle(hit(1100, 6000, AbilityEffectSeverity.Critical))
    // A critical hit is a potency sample too, marked as one
    expect(sample).toMatchObject({ type: 'potencySample', data: { critical: true, direct: false } })
    expect(split).toMatchObject({ type: 'damageAttributed', data: { id: 2 } })
    // Hits that are not critical bring the natural rate down, which changes the split of the critical hit
    for (let index = 0; index < 30; index++) engine.handle(hit(1200 + index, 3000))
    expect(engine.handle(summed(1300))).toEqual([])

    const output = engine.drain(20000)
    expect(types(output)).toEqual(['periodicTick', 'attributionRevision', 'periodicRevision'])
    expect(output[1]).toMatchObject({
      data: { records: expect.arrayContaining([expect.objectContaining({ id: 2, actorId: SAMURAI })]) },
    })
    expect(engine.drain(40000)).toEqual([])
  })

  it('confirms a tick with the status list before the statuses of the same packet change', () => {
    const engine = new CombatEngine(testDefs(), world())
    // Calibration hits of the astrologian give the snapshot of Combust a prior
    for (const amount of [10800, 11070, 10530])
      engine.handle({
        type: 'effect',
        time: 1000,
        caster: ASTROLOGIAN,
        action: 25871,
        sequence: 1,
        targets: [effectTarget(ENEMY, 0, [damage(amount)])],
      })
    engine.handle({
      type: 'effect',
      time: 2000,
      caster: ASTROLOGIAN,
      action: COMBUST.action,
      sequence: 2,
      targets: [effectTarget(ENEMY, 0, [], [apply(COMBUST.status, 174, 58)])],
    })
    engine.handle({
      type: 'statuses',
      time: 2000,
      holder: ENEMY,
      slots: [{ slot: 0, status: { id: COMBUST.status, source: ASTROLOGIAN, stacks: 0 } }],
      changes: [{ kind: 'gained', slot: 0, status: COMBUST.status, source: ASTROLOGIAN }],
    })
    engine.handle(summed(5000))
    // The packet that ends Combust lists it, and the slot clears after the list confirmed the tick
    const confirmed = engine.handle({
      type: 'statusList',
      time: 5010,
      holder: ENEMY,
      statuses: [{ id: COMBUST.status, source: ASTROLOGIAN }],
    })
    expect(confirmed).toMatchObject([
      {
        type: 'periodicTick',
        data: { confirmed: true, shares: [{ sourceId: ASTROLOGIAN, statusId: COMBUST.status, basis: 'exact' }] },
      },
      { type: 'damageAttributed' },
    ])
    engine.handle({
      type: 'statuses',
      time: 5010,
      holder: ENEMY,
      slots: [{ slot: 0, status: null }],
      changes: [{ kind: 'lost', slot: 0, status: COMBUST.status, source: ASTROLOGIAN }],
    })
    expect(engine.world.getBuffs(ENEMY)).toEqual([])
  })

  it('reads the actors from a world the caller keeps', () => {
    const combatants = testCombatants()
    const engine = new CombatEngine(testDefs(), combatants)
    expect(types(engine.handle(hit(1000, 3000)))).toEqual(['potencySample', 'damageAttributed'])
    combatants.update(SAMURAI, { level: 0 })
    expect(types(engine.handle(hit(1100, 3000)))).toEqual(['damageAttributed'])
  })

  it('loads the data it ships', () => {
    expect(new CombatEngine(periodicDefs).defs.version).toBe(periodicDefs.version)
  })
})
