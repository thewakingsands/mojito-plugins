import { expect, it } from 'vitest'
import { penaltyStatuses } from './catalog.js'

it('lists the penalties', () => {
  expect(penaltyStatuses.size).toBeGreaterThan(0)
})
