import { describe, expect, it } from 'vitest'
import { ASTROLOGIAN, ENEMY, SAGE, SAMURAI } from '../testing/periodic.js'
import { apply, applyExample, COMBUST, example, Harness, HIGANBANA } from '../testing/periodic-harness.js'
import { allocate, GaussianState, removeTick, roundShares } from './gaussian.js'

const BOTH: [number, number][] = [
  [COMBUST.status, ASTROLOGIAN],
  [HIGANBANA.status, SAMURAI],
]

/** The example, then confirmed ticks of both statuses with the totals */
function battle(totals: number[], unconfirmed: number[] = []) {
  const harness = applyExample(example())
  for (const total of totals) harness.later(3000).tick(ENEMY, total).later(10).list(ENEMY, BOTH)
  // a tick without a status list: the next event is more than 100 ms later
  for (const total of unconfirmed) harness.later(3000).tick(ENEMY, total).later(200).tick(SAGE, 1, true)
  return harness.later(10_000).close()
}

describe('reviseBattle', () => {
  it('splits each confirmed tick without what it taught the state', () => {
    const totals = [7000, 6500, 7300]
    const harness = battle(totals)
    const [revision] = harness.revisions
    const merged = revision.ticks.filter((tick) => tick.combatant === ENEMY)
    expect(merged.map((tick) => tick.total)).toEqual(totals)
    for (const tick of merged) {
      expect(tick.phase).toBe('post')
      expect(tick.shares.reduce((sum, share) => sum + share.amount, 0)).toBe(tick.total)
      expect(tick.shares.map((share) => share.basis)).toEqual(['estimated', 'estimated'])
    }
  })

  it('matches a split by hand', () => {
    const totals = [7000, 6500]
    const harness = battle(totals)
    const merged = harness.revisions[0].ticks.filter((tick) => tick.combatant === ENEMY)
    expect(harness.estimator.battleTicks).toEqual([])

    // μ and r of the example; no sample came after the snapshots, so the priors are the same
    const members = [
      { id: 1, prior: 3613.4486 },
      { id: 2, prior: 2783.0894 },
    ]
    const noise = [746112.6, 477392.6]
    const R = noise[0] + noise[1]
    const state = new GaussianState()
    state.addSnapshot(1, 'astrologian')
    state.addSnapshot(2, 'samurai')
    for (const total of totals) state.update(members, total, R)
    totals.forEach((total, index) => {
      const block = removeTick(state.block(members), R, total)
      const expected = roundShares(allocate(block, noise, total), total)
      const actual = merged[index].shares.map((share) => share.amount)
      for (let at = 0; at < 2; at++) expect(Math.abs(actual[at] - expected[at])).toBeLessThanOrEqual(1)
    })
  })

  it('splits a confirmed tick of one source as the realtime split did', () => {
    const harness = applyExample(example())
    harness
      .later(3000)
      .tick(ENEMY, 5000)
      .later(10)
      .list(ENEMY, [[COMBUST.status, ASTROLOGIAN]])
    harness.later(10_000).close()
    const realtime = harness.output.find((tick) => tick.total === 5000)
    const post = harness.revisions[0].ticks.find((tick) => tick.total === 5000)
    expect(post?.shares).toEqual(realtime?.shares)
  })

  it('leaves the unconfirmed ticks out of the update', () => {
    const without = battle([7000, 6500])
    const withUnconfirmed = battle([7000, 6500], [9000])
    const confirmedOf = (harness: Harness) =>
      harness.revisions[0].ticks.filter((tick) => tick.confirmed).map((tick) => tick.shares)
    expect(confirmedOf(withUnconfirmed)).toEqual(confirmedOf(without))
    const unconfirmed = withUnconfirmed.revisions[0].ticks.find((tick) => tick.total === 9000)
    expect(unconfirmed?.shares.map((share) => share.basis)).toEqual(['unconfirmed', 'unconfirmed'])
  })

  it('keeps the id, the time, the combatant and the total of every realtime tick', () => {
    const harness = battle([7000, 6500], [9000])
    const realtime = harness.output.filter((tick) => tick.statusId === 0)
    const post = harness.revisions[0].ticks
    expect(
      post.map(({ tickId, eventTime, combatant, total, prediction, confirmed }) => ({
        tickId,
        eventTime,
        combatant,
        total,
        prediction,
        confirmed,
      })),
    ).toEqual(
      realtime.map(({ tickId, eventTime, combatant, total, prediction, confirmed }) => ({
        tickId,
        eventTime,
        combatant,
        total,
        prediction,
        confirmed,
      })),
    )
    expect(harness.revisions[0]).toMatchObject({ eventType: 'PeriodicRevisionEvent', eventTime: harness.time })
    // The next battle starts empty
    harness.close()
    expect(harness.revisions).toHaveLength(1)
  })

  it('splits a tick whose snapshots had no prior when it came, with the samples of the whole battle', () => {
    const harness = new Harness()
    harness
      .effect(ASTROLOGIAN, COMBUST.action, [{ target: ENEMY, raw: [apply(COMBUST.status, 174, 58)] }])
      .gain(ENEMY, COMBUST.status, ASTROLOGIAN, 0)
      .effect(SAMURAI, HIGANBANA.action, [{ target: ENEMY, raw: [apply(HIGANBANA.status, 6, 250)] }])
      .gain(ENEMY, HIGANBANA.status, SAMURAI, 1)
      .later(1000)
      .tick(ENEMY, 7000)
      .later(10)
      .list(ENEMY, BOTH)
    expect(harness.last()).toMatchObject({ unknown: 7000, shares: [] })
    example(harness).later(10_000).close()
    const [tick] = harness.revisions[0].ticks
    expect(tick.unknown).toBe(0)
    expect(tick.shares.map((share) => share.basis)).toEqual(['estimated', 'estimated'])
    expect(tick.shares.reduce((sum, share) => sum + share.amount, 0)).toBe(7000)
  })
})
