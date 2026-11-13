import { describe, expect, it } from 'vitest'
import { CombatEngine } from './engine.js'
import type { CombatInput } from './input.js'
import { deviates, TelemetryCollector, type TelemetrySample } from './telemetry.js'
import { testDefs } from './testing/periodic.js'
import { MemoryWorld } from './world.js'

const sample = (
  correctedDamagePerPotency = 100,
  unknownStatuses: TelemetrySample['unknownStatuses'] = [],
): TelemetrySample => ({
  casterId: 1,
  targetId: 2,
  classJob: 34,
  level: 100,
  actionId: 7477,
  damageType: 'slashing',
  correctedDamagePerPotency,
  unknownStatuses,
})
const unknown = [
  { id: 40001, param: 1 },
  { id: 40001, param: 2 },
  { id: 40002, param: 0 },
]
const add = (collector: TelemetryCollector, input: TelemetrySample, n = 5) => {
  for (let i = 0; i < n; i++) collector.add(input)
}

describe('anonymous observations', () => {
  it.each([90, 110])('does not include the exact threshold %s', (r) => expect(deviates(r, 100)).toBe(false))
  it.each([89, 111, 110.000000001])('includes values strictly beyond the threshold %s', (r) =>
    expect(deviates(r, 100)).toBe(true),
  )
  it('uses means, includes all unknown params and drops local identifiers', () => {
    const collector = new TelemetryCollector()
    add(collector, sample(), 12)
    add(collector, sample(70, unknown), 8)
    const [observation] = collector.finish()
    expect(observation).toEqual({
      unknownStatuses: unknown,
      unknownStatusIds: [40001, 40002],
      classJob: 34,
      level: 100,
      actionId: 7477,
      damageType: 'slashing',
      sampleCount: 8,
      baselineSampleCount: 12,
      correctedDamagePerPotency: 70,
      baselineDamagePerPotency: 100,
    })
    expect(collector.finish()).toEqual([])
  })
  it.each(['casterId', 'targetId', 'actionId', 'damageType'] as const)('does not match a different %s', (key) => {
    const collector = new TelemetryCollector()
    add(collector, sample())
    add(collector, { ...sample(70, unknown), [key]: key === 'damageType' ? 'magic' : 3 })
    expect(collector.finish()).toEqual([])
  })
  it('requires five candidates and five clean samples', () => {
    for (const [clean, candidate] of [
      [0, 5],
      [4, 5],
      [5, 4],
    ]) {
      const collector = new TelemetryCollector()
      add(collector, sample(), clean)
      add(collector, sample(70, unknown), candidate)
      expect(collector.finish()).toEqual([])
    }
  })
  it('discards an actor after a profile change and invalidates overfull or nonfinite encounters', () => {
    const collector = new TelemetryCollector()
    add(collector, sample())
    add(collector, sample(70, unknown))
    collector.profile(1, 34, 99)
    collector.profile(1, 34, 100)
    expect(collector.finish()).toEqual([])
    for (const n of [4097, 257]) {
      const c = new TelemetryCollector()
      for (let i = 0; i < n; i++) {
        add(c, { ...sample(), targetId: i })
        add(c, { ...sample(70, unknown), targetId: i })
      }
      expect(c.finish()).toEqual([])
    }
    const c = new TelemetryCollector()
    add(c, sample())
    add(c, sample(Number.MAX_VALUE, unknown))
    expect(c.finish()).toEqual([])
  })
})

describe('model telemetry snapshots', () => {
  const engine = () => {
    const world = new MemoryWorld()
    world.handle({ type: 'actor', time: 0, actorId: 1, classJob: 34, level: 100, ownerId: 0 })
    return new CombatEngine(testDefs(), world)
  }
  const hit: CombatInput = {
    type: 'effect',
    time: 100,
    caster: 1,
    action: 7477,
    sequence: 1,
    targets: [
      {
        id: 2,
        index: 0,
        hits: [{ result: 'damage', amount: 20000, critical: false, direct: false, bonusPercent: 0, onSource: false }],
        applied: [],
      },
    ],
  }
  const statuses = (ids: number[]): CombatInput => ({
    type: 'statuses',
    time: 10,
    holder: 1,
    slots: Array.from({ length: 5 }, (_, slot) => ({
      slot,
      status: ids[slot] ? { id: ids[slot], source: 1, stacks: slot } : null,
    })),
    changes: [],
  })
  it('leaves existing outputs identical and captures unknown statuses at the hit', () => {
    const off = engine(),
      on = engine()
    on.setTelemetryEnabled(true)
    for (const input of [statuses([1228, 40001, 40002]), hit]) {
      const outputs = on.handle(input)
      expect(outputs.filter((o) => o.type !== 'telemetrySample')).toEqual(off.handle(input))
      if (input.type === 'effect') {
        const captured = outputs.find((o) => o.type === 'telemetrySample')
        expect(captured).toMatchObject({
          data: {
            unknownStatuses: [
              { id: 40001, param: 1 },
              { id: 40002, param: 2 },
            ],
            correctedDamagePerPotency: 100,
          },
        })
        on.handle(statuses([]))
        expect(captured).toMatchObject({
          data: {
            unknownStatuses: [
              { id: 40001, param: 1 },
              { id: 40002, param: 2 },
            ],
          },
        })
      }
    }
  })
  it('excludes critical, direct, missing application bytes and unknown source levels only when relevant', () => {
    const e = engine()
    e.setTelemetryEnabled(true)
    for (const id of [1878, 444]) {
      e.handle(statuses([id]))
      expect(e.handle(hit).some((o) => o.type === 'telemetrySample')).toBe(false)
    }
    e.handle(statuses([1892]))
    expect(e.handle(hit).some((o) => o.type === 'telemetrySample')).toBe(true)
    e.handle(statuses([]))
    for (const field of ['critical', 'direct']) {
      const modified = structuredClone(hit)
      modified.targets[0].hits[0][field as 'critical' | 'direct'] = true
      expect(e.handle(modified).some((o) => o.type === 'telemetrySample')).toBe(false)
    }
  })
  it('corrects known multipliers before comparing means', () => {
    const e = engine()
    e.setTelemetryEnabled(true)
    e.handle(statuses([1298, 40001]))
    const output = e
      .handle({ ...hit, targets: [{ ...hit.targets[0], hits: [{ ...hit.targets[0].hits[0], amount: 22600 }] }] })
      .find((o) => o.type === 'telemetrySample')
    expect(output?.data.correctedDamagePerPotency).toBeCloseTo(100)
  })
})
