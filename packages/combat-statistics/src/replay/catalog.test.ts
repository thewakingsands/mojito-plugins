import { expect, it } from 'vitest'
import { partyMitigations, penaltyStatuses, raidBuffs } from './catalog.js'

it('lists raid buffs, party mitigations and penalties, each skill in one lane', () => {
  expect(raidBuffs.size).toBeGreaterThan(0)
  expect(partyMitigations.size).toBeGreaterThan(0)
  expect(penaltyStatuses.size).toBeGreaterThan(0)
  for (const id of raidBuffs.keys()) expect(partyMitigations.has(id)).toBe(false)
  for (const duration of [...raidBuffs.values(), ...partyMitigations.values()]) {
    expect(Number.isInteger(duration)).toBe(true)
    expect(duration).toBeGreaterThan(0)
  }
})
