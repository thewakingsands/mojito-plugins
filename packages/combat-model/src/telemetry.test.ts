import { describe, expect, it } from 'vitest'
import { CombatEngine } from './engine.js'
import type { CombatInput } from './input.js'
import { fitPayload, TelemetryCollector, type TelemetrySample } from './telemetry.js'
import { testDefs } from './testing/periodic.js'
import { MemoryWorld } from './world.js'

const unknown = [
  { id: 40001, param: 1 },
  { id: 40001, param: 2 },
  { id: 40002, param: 0 },
]
const sample = (value = 100, unknownStatuses: TelemetrySample['unknownStatuses'] = []): TelemetrySample => ({
  casterId: 1,
  targetId: 2,
  classJob: 34,
  level: 100,
  actionId: 7477,
  damageType: 'slashing',
  normal: { value, potency: 200 },
  critical: { hit: false, addedRate: 0 },
  direct: { hit: false, addedRate: 0 },
  unknownStatuses,
})
const add = (collector: TelemetryCollector, input: TelemetrySample, n = 5) => {
  for (let i = 0; i < n; i++) collector.add(input)
}
describe('anonymous observations', () => {
  it('reports small and zero deviations, snapshots all unknown params and drops local identifiers', () => {
    const collector = new TelemetryCollector()
    add(collector, sample(), 12)
    const input = sample(108, structuredClone(unknown))
    add(collector, input, 8)
    input.unknownStatuses[0].id = 99
    const body = collector.finish()
    expect(body.profiles).toEqual([
      {
        classJob: 34,
        level: 100,
        critical: { hits: 12, successes: 0, addedRate: 0 },
        direct: { hits: 12, successes: 0, addedRate: 0 },
      },
    ])
    expect(body.observations).toEqual([
      {
        profile: 0,
        unknownStatuses: unknown,
        actionId: 7477,
        damageType: 'slashing',
        normal: { count: 8, sum: 864, sumSquares: 93312, potencySum: 1600 },
        baseline: { count: 12, sum: 1200, sumSquares: 120000 },
        critical: { hits: 8, successes: 0, addedRate: 0 },
        direct: { hits: 8, successes: 0, addedRate: 0 },
      },
    ])
    expect(JSON.stringify(body)).not.toMatch(/casterId|targetId/)
    expect(collector.finish()).toEqual({ profiles: [], observations: [] })
    const zero = new TelemetryCollector()
    add(zero, sample(100, unknown))
    expect(zero.finish().observations).toHaveLength(1)
  })
  it.each(['casterId', 'targetId', 'actionId', 'damageType'] as const)(
    'does not match damage baselines across %s',
    (key) => {
      const collector = new TelemetryCollector()
      add(collector, sample())
      add(collector, { ...sample(70, unknown), [key]: key === 'damageType' ? 'magic' : 3 })
      expect(collector.finish().observations[0].baseline.count).toBe(0)
    },
  )
  it('shares the clean probability control across actions but never includes unknown statuses', () => {
    const collector = new TelemetryCollector()
    add(collector, { ...sample(), critical: { hit: true, addedRate: 0.1 } })
    add(collector, { ...sample(100, unknown), actionId: 3, normal: null, critical: { hit: true, addedRate: 0.2 } })
    add(collector, {
      ...sample(100, unknown),
      actionId: 4,
      normal: null,
      critical: null,
      direct: { hit: true, addedRate: 0 },
    })
    const body = collector.finish()
    expect(body.profiles[0].critical).toEqual({ hits: 5, successes: 5, addedRate: 0.5 })
    expect(body.observations).toHaveLength(1)
    expect(body.observations[0]).toMatchObject({
      actionId: 3,
      normal: { count: 0 },
      critical: { hits: 5, successes: 5, addedRate: 1 },
    })
  })
  it('accepts five critical participants or five normal hits, with no required baseline', () => {
    for (const normal of [null, { value: 100, potency: 200 }]) {
      const collector = new TelemetryCollector()
      const input = { ...sample(100, unknown), normal, critical: normal ? null : { hit: true, addedRate: 0 } }
      add(collector, input, 4)
      expect(collector.finish().observations).toEqual([])
      const enough = new TelemetryCollector()
      add(enough, input)
      expect(enough.finish().observations).toHaveLength(1)
    }
  })
  it('discards changed profiles and invalidates overfull or nonfinite encounters', () => {
    const collector = new TelemetryCollector()
    add(collector, sample(100, unknown))
    collector.profile(1, 34, 99)
    collector.profile(1, 34, 100)
    add(collector, sample(100, unknown))
    expect(collector.finish().observations).toEqual([])
    for (const value of [Number.MAX_VALUE, Number.NaN]) {
      const c = new TelemetryCollector()
      add(c, sample(value, unknown))
      expect(c.finish().observations).toEqual([])
    }
    const c = new TelemetryCollector()
    for (let i = 0; i < 4097; i++) c.add({ ...sample(), targetId: i })
    add(c, sample(100, unknown))
    expect(c.finish().observations).toEqual([])
  })
  it('fits a realistic 360-observation encounter without truncation', () => {
    const c = new TelemetryCollector()
    for (let actor = 1; actor <= 8; actor++)
      for (let combo = 0; combo < 3; combo++)
        for (let action = 1; action <= 15; action++)
          add(c, { ...sample(100, [{ id: 40000 + combo, param: 0 }]), casterId: actor, actionId: action })
    const body = c.finish()
    expect(body.observations).toHaveLength(360)
    expect(fitPayload(body, 1024, 256 * 1024, JSON.stringify)).toEqual(body)
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThan(256 * 1024)
  })
  it('drops least sampled groups deterministically and compacts profile references', () => {
    const c = new TelemetryCollector()
    add(c, sample(100, unknown), 6)
    add(c, { ...sample(100, unknown), casterId: 2 }, 5)
    add(c, { ...sample(100, unknown), casterId: 3 }, 5)
    const body = c.finish()
    const fitted = fitPayload(body, 2, 256 * 1024, JSON.stringify)!
    expect(fitted.profiles).toHaveLength(2)
    expect(fitted.observations.map((o) => o.profile)).toEqual([0, 1])
    const maxBytes = new TextEncoder().encode(
      JSON.stringify(fitPayload(body, 1, 256 * 1024, JSON.stringify)),
    ).byteLength
    const small = fitPayload(body, 1024, maxBytes, JSON.stringify)
    expect(small?.observations).toHaveLength(1)
    expect(fitPayload(body, 1024, maxBytes, JSON.stringify)).toEqual(small)
    expect(fitPayload(body, 1024, 1, JSON.stringify)).toBeNull()
  })
})

describe('model telemetry snapshots', () => {
  const engine = (forced = false) => {
    const world = new MemoryWorld()
    world.handle({ type: 'actor', time: 0, actorId: 1, classJob: 34, level: 100, ownerId: 0 })
    return new CombatEngine(
      testDefs((input) => {
        if (forced) input.statuses.push({ id: 50000, modifiers: [{ type: 'forceCritical' }] })
      }),
      world,
    )
  }
  const hit: Extract<CombatInput, { type: 'effect' }> = {
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
  it('preserves existing outputs and captures the statuses at the hit', () => {
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
            normal: { value: 100, potency: 200 },
          },
        })
        on.handle(statuses([]))
        expect(captured?.data.unknownStatuses).toHaveLength(2)
      }
    }
  })
  it('requires complete calibration and includes critical and direct hits without normal damage', () => {
    const e = engine()
    e.setTelemetryEnabled(true)
    for (const id of [1878, 444]) {
      e.handle(statuses([id]))
      expect(e.handle(hit).some((o) => o.type === 'telemetrySample')).toBe(false)
    }
    e.handle(statuses([1892]))
    expect(e.handle(hit).some((o) => o.type === 'telemetrySample')).toBe(true)
    e.handle(statuses([]))
    for (const field of ['critical', 'direct'] as const) {
      const modified = structuredClone(hit)
      modified.targets[0].hits[0][field] = true
      expect(e.handle(modified).find((o) => o.type === 'telemetrySample')?.data).toMatchObject({
        normal: null,
        [field]: { hit: true, addedRate: 0 },
      })
    }
  })
  it('excludes known forced outcomes, pets and secondary targets', () => {
    const e = engine(true)
    e.setTelemetryEnabled(true)
    e.handle(statuses([50000]))
    expect(e.handle(hit).find((o) => o.type === 'telemetrySample')?.data).toMatchObject({
      normal: null,
      critical: null,
      direct: { hit: false },
    })
    e.handle({ type: 'actor', time: 0, actorId: 1, classJob: 34, level: 100, ownerId: 3 })
    expect(e.handle(hit).some((o) => o.type === 'telemetrySample')).toBe(false)
    const other = engine()
    other.setTelemetryEnabled(true)
    expect(
      other.handle({ ...hit, targets: [{ ...hit.targets[0], index: 1 }] }).some((o) => o.type === 'telemetrySample'),
    ).toBe(false)
  })
  it('corrects known multipliers before accumulating damage', () => {
    const e = engine()
    e.setTelemetryEnabled(true)
    e.handle(statuses([1298, 40001]))
    const output = e
      .handle({ ...hit, targets: [{ ...hit.targets[0], hits: [{ ...hit.targets[0].hits[0], amount: 22600 }] }] })
      .find((o) => o.type === 'telemetrySample')
    expect(output?.data.normal?.value).toBeCloseTo(100)
  })
})
