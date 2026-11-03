import { describe, expect, it } from 'vitest'
import { limitNames, limitsSnapshot } from './limits.js'

function policy() {
  return {
    schemaVersion: 1,
    revision: 'synthetic-policy',
    values: Object.fromEntries(limitNames.map((name) => [name, 1])),
  }
}

describe('activation limits', () => {
  it('copies and freezes the policy while retaining future keys', () => {
    const input = policy()
    input.values['future.budget'] = 123
    input.values['batch.waitMs'] = 0
    const result = limitsSnapshot(input)
    input.values['future.budget'] = 456
    input.revision = 'changed'
    expect(result.revision).toBe('synthetic-policy')
    expect(result.values['future.budget']).toBe(123)
    expect(result.values['batch.waitMs']).toBe(0)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.values)).toBe(true)
    expect(() => Object.assign(result.values, { 'batch.waitMs': 99 })).toThrow()
  })

  it('rejects an incomplete hello instead of inventing a resource budget', () => {
    const input = policy()
    delete input.values['queue.pluginBytes']
    expect(() => limitsSnapshot(input)).toThrow('queue.pluginBytes')
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, '123', 1n, null, undefined])(
    'rejects invalid known and future values: %s',
    (value) => {
      for (const name of ['batch.items', 'future.budget']) {
        const input = policy()
        Object.assign(input.values, { [name]: value })
        expect(() => limitsSnapshot(input)).toThrow(`Invalid limit: ${name}`)
      }
    },
  )

  it('rejects incompatible schema, missing revision and non-record values', () => {
    for (const patch of [{ schemaVersion: 2 }, { revision: undefined }, { values: [] }, { values: new Map() }]) {
      expect(() => limitsSnapshot({ ...policy(), ...patch })).toThrow()
    }
    expect(() => limitsSnapshot(null)).toThrow()
  })

  it('preserves special string keys without modifying the result prototype', () => {
    const input = policy()
    Object.defineProperty(input.values, '__proto__', { value: 7, enumerable: true })
    const result = limitsSnapshot(input)
    expect(Object.getPrototypeOf(result.values)).toBeNull()
    expect(Object.getOwnPropertyDescriptor(result.values, '__proto__')?.value).toBe(7)
  })
})
