import { expect, it } from 'vitest'
import { Encounters } from './encounters.js'
import { actors, effect, npcParty, sample } from './fixtures.js'

const setup = () => {
  let id = 0
  const encounters = new Encounters(
    () => `battle-${++id}`,
    () => {},
  )
  encounters.updateActors(actors())
  encounters.localActorId = 1
  return encounters
}
const died = (seq: number, actorId: number, at: number) =>
  sample({ type: 'actorDied', packet: effect(seq).packet, data: { actorId, causedByActorId: 9 } }, at)
const hp = (seq: number, actorId: number, hpCur: number, hpMax: number) =>
  sample(
    {
      type: 'hpChanged',
      packet: effect(seq).packet,
      data: { origin: 'effectResult' as const, actorId, hpCur, hpMax, sequence: null },
    },
    seq,
  )
/** Ends the active fight and returns its outcome */
const outcome = (encounters: Encounters, at: number) => {
  encounters.end(encounters.active!.id, at)
  return encounters.snapshot(encounters.completed[0], false)!.outcome
}

it('picks the enemy that took the most damage and leaves a running fight without a result', () => {
  const encounters = setup()
  encounters.updateActors(
    new Map([
      ...actors(),
      [8, { key: 'source:1:8', id: 8, name: '小怪', worldId: null, job: null, kind: 'enemy', ownerKey: null }],
    ]),
  )
  encounters.accept(sample(effect(1, 100, 1, 8), 1000), 1000)
  encounters.accept(sample(effect(2, 80, 1, 9), 1100), 1100)
  encounters.accept(sample(effect(3, 80, 2, 9), 1200), 1200)
  encounters.accept(hp(4, 9, 2500, 10_000), 1300)
  expect(encounters.snapshot()!.outcome).toEqual({
    result: null,
    mainEnemy: { key: 'source:1:9', name: '目标', hpCur: 2500, hpMax: 10_000, hpPercent: 25 },
  })
  expect(encounters.snapshot()!.title).toBe('目标')
})
it('counts the damage of the limit break row for the main enemy', () => {
  const encounters = setup()
  encounters.updateActors(
    new Map([
      ...actors(),
      [8, { key: 'source:1:8', id: 8, name: '小怪', worldId: null, job: null, kind: 'enemy', ownerKey: null }],
    ]),
  )
  encounters.accept(sample(effect(1, 100, 1, 8), 1000), 1000)
  const braver = effect(2, 500, 1, 9)
  braver.data.actionId = 200
  encounters.accept(sample(braver, 1100), 1100)
  const summary = encounters.snapshot()!
  expect(summary.rows.find((row) => row.actor.kind === 'member')?.targets['source:1:9']).toBeUndefined()
  expect(summary.outcome.mainEnemy?.key).toBe('source:1:9')
})
it('is a kill when the main enemy dies, even when the party died too', () => {
  const encounters = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample(effect(2, 50, 2), 1100), 1100)
  encounters.accept(died(3, 1, 1200), 1200)
  encounters.accept(died(4, 2, 1300), 1300)
  encounters.accept(died(5, 9, 1400), 1400)
  expect(outcome(encounters, 2000).result).toBe('kill')
})
it('is a wipe when every member died and did nothing after the last death', () => {
  const encounters = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample(effect(2, 50, 2), 1100), 1100)
  encounters.accept(hp(3, 9, 7660, 10_000), 1150)
  encounters.accept(died(4, 1, 1200), 1200)
  encounters.accept(died(5, 2, 1300), 1300)
  // The pet does not keep the party alive.
  encounters.accept(sample(effect(6, 10, 3), 1400), 1400)
  expect(outcome(encounters, 2000)).toEqual({
    result: 'wipe',
    mainEnemy: { key: 'source:1:9', name: '目标', hpCur: 7660, hpMax: 10_000, hpPercent: 76.6 },
  })
})
it('is not a wipe when a member was raised and attacked again', () => {
  const encounters = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(sample(effect(2, 50, 2), 1100), 1100)
  encounters.accept(died(3, 1, 1200), 1200)
  encounters.accept(died(4, 2, 1300), 1300)
  encounters.accept(sample(effect(5, 40, 2), 1400), 1400)
  expect(outcome(encounters, 2000).result).toBe('ended')
})
it('has no main enemy when no enemy took damage', () => {
  const encounters = setup()
  // Incoming damage opens the fight.
  encounters.accept(sample(effect(1, 100, 9, 1), 1000), 1000)
  expect(outcome(encounters, 2000)).toEqual({ result: 'ended', mainEnemy: null })
})
it('keeps one enemy across the generations the game gives it when it moves the fight to a new arena', () => {
  const encounters = setup()
  encounters.accept(sample(effect(1, 600), 1000), 1000)
  // The game removed every actor and added them again; the enemy is the same, with a new generation.
  const moved = new Map(actors())
  moved.set(9, { ...moved.get(9)!, key: 'source:2:9' })
  encounters.updateActors(moved)
  encounters.accept(sample(effect(2, 100), 2000), 2000)
  encounters.accept(sample(effect(3, 300, 2, 8), 2100), 2100)
  encounters.accept(hp(4, 9, 0, 10_000), 2200)
  encounters.accept(died(5, 9, 2300), 2300)
  expect(outcome(encounters, 3000)).toEqual({
    result: 'kill',
    mainEnemy: { key: 'source:2:9', name: '目标', hpCur: 0, hpMax: 10_000, hpPercent: 0 },
  })
})
it('is a kill when the main enemy reaches 0 HP and the game leaves combat before reporting its death', () => {
  const encounters = setup()
  encounters.accept(sample(effect(1), 1000), 1000)
  encounters.accept(hp(2, 9, 0, 10_000), 1100)
  expect(outcome(encounters, 2000).result).toBe('kill')
})
it('takes NPC party members as members for the main enemy and the wipe', () => {
  const encounters = setup()
  encounters.updateActors(npcParty())
  encounters.accept(sample(effect(1, 100, 4, 9), 1000), 1000)
  encounters.accept(died(2, 1, 1100), 1100)
  // the NPC party member is still alive, so the player's death alone is no wipe
  expect(outcome(encounters, 2000)).toMatchObject({ result: 'ended', mainEnemy: { key: 'source:0:9' } })
  encounters.accept(sample(effect(3, 100, 4, 9), 3000), 3000)
  encounters.accept(died(4, 1, 3100), 3100)
  encounters.accept(died(5, 4, 3200), 3200)
  encounters.end(encounters.active!.id, 4000)
  expect(encounters.snapshot(encounters.completed[0], false)!.outcome.result).toBe('wipe')
})
