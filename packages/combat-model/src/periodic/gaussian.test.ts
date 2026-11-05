import { describe, expect, it } from 'vitest'
import { allocate, GaussianState, removeTick, roundShares, SNAPSHOT_SPREAD, SOURCE_SPREAD } from './gaussian.js'

// The example of design.md: Combust III of the astrologian and Higanbana of the samurai
const COMBUST = { id: 1, prior: 3613.4486 }
const HIGANBANA = { id: 2, prior: 2783.0894 }
const NOISE = [746112.6, 477392.6]
const R = NOISE[0] + NOISE[1]

function example() {
  const state = new GaussianState()
  state.addSnapshot(COMBUST.id, 'astrologian')
  state.addSnapshot(HIGANBANA.id, 'samurai')
  return state
}

describe('GaussianState', () => {
  it('starts with the covariance of the example', () => {
    const { covariance } = example().block([COMBUST, HIGANBANA])
    const variance = SNAPSHOT_SPREAD ** 2 + SOURCE_SPREAD ** 2
    expect(covariance[0][0]).toBeCloseTo(variance * COMBUST.prior ** 2, 6)
    expect(covariance[1][1]).toBeCloseTo(variance * HIGANBANA.prior ** 2, 6)
    expect(covariance[0][1]).toBe(0)
  })

  it('predicts, allocates and updates as the example', () => {
    const state = example()
    const members = [COMBUST, HIGANBANA]
    expect(state.predict(members)).toBeCloseTo(6396.54, 1)
    const shares = allocate(state.block(members), NOISE, 7000)
    expect(shares[0]).toBeCloseTo(3982.86, 1)
    expect(shares[1]).toBeCloseTo(3017.14, 1)
    expect(roundShares(shares, 7000)).toEqual([3983, 3017])

    state.update(members, 7000, R)
    const { mean } = state.block(members)
    expect(mean[0]).toBeCloseTo(3663.23, 1)
    expect(mean[1]).toBeCloseTo(2812.62, 1)
  })

  it('shares the scale of a caster among its snapshots', () => {
    const state = new GaussianState()
    state.addSnapshot(1, 'astrologian')
    state.addSnapshot(2, 'astrologian')
    const one = { id: 1, prior: 3000 }
    const two = { id: 2, prior: 3000 }
    expect(state.block([one, two]).covariance[0][1]).toBeCloseTo(SOURCE_SPREAD ** 2 * 3000 * 3000, 6)

    state.update([one], 3600, 100000)
    const [, after] = state.block([one, two]).mean
    expect(after).toBeGreaterThan(3000)

    // A later snapshot of the caster takes the scale it learned
    state.addSnapshot(3, 'astrologian')
    expect(state.block([{ id: 3, prior: 3000 }]).mean[0]).toBeCloseTo(after, 9)
  })

  it('keeps the marginal of the others when a snapshot leaves', () => {
    const state = new GaussianState()
    state.addSnapshot(1, 'a')
    state.addSnapshot(2, 'a')
    state.addSnapshot(3, 'b')
    const members = [
      { id: 1, prior: 1000 },
      { id: 2, prior: 2000 },
      { id: 3, prior: 3000 },
    ]
    state.update(members, 6600, 50000)
    const before = state.block([members[0], members[2]])
    state.removeSnapshot(2)
    expect(state.hasSnapshot(2)).toBe(false)
    const after = state.block([members[0], members[2]])
    for (let i = 0; i < 2; i++) {
      expect(after.mean[i]).toBeCloseTo(before.mean[i], 9)
      for (let j = 0; j < 2; j++) expect(after.covariance[i][j]).toBeCloseTo(before.covariance[i][j], 6)
    }
  })

  it('takes the information of a tick out of the block', () => {
    const state = example()
    const members = [COMBUST, HIGANBANA]
    const before = state.block(members)
    state.update(members, 7000, R)
    const undone = removeTick(state.block(members), R, 7000)
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(undone.mean[i] - before.mean[i])).toBeLessThan(1e-9 * before.mean[i])
      for (let j = 0; j < 2; j++) {
        expect(Math.abs(undone.covariance[i][j] - before.covariance[i][j])).toBeLessThan(
          1e-9 * Math.max(1, before.covariance[i][i]),
        )
      }
    }
  })
})

describe('allocate', () => {
  it('projects a negative share to 0 and keeps the sum', () => {
    const block = {
      mean: [1000, 10],
      covariance: [
        [1, 0],
        [0, 1],
      ],
    }
    const shares = allocate(block, [0, 1e6], 50)
    expect(shares.every((value) => value >= 0)).toBe(true)
    expect(shares[0] + shares[1]).toBeCloseTo(50, 9)
  })
})

describe('roundShares', () => {
  it('keeps the sum', () => {
    expect(roundShares([3982.86, 3017.14], 7000)).toEqual([3983, 3017])
    expect(roundShares([1.4, 1.4, 1.2], 4)).toEqual([2, 1, 1])
    expect(roundShares([0.5, 0.5, 0.5, 0.5], 2)).toEqual([1, 1, 0, 0])
    expect(roundShares([10], 10)).toEqual([10])
  })
})
