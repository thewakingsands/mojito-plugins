import { describe, expect, it } from 'vitest'
import fixture from '../../combat-statistics/testdata/telemetry-v1.json' with { type: 'json' }
import type { ActionType } from './defs.js'
import { TelemetryCollector } from './telemetry.js'
import { analyze, formatMarkdown, readEvents, runCli, type TelemetryEvent } from './telemetry-analysis.js'

const actionTypes = new Map<number, ActionType>([
  [1, { category: 'weaponskill', attackType: 'physical' }],
  [2, { category: 'spell', attackType: 'magic' }],
])
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
function synthetic(
  options: {
    damage?: number
    magic?: number
    potency?: number
    critical?: number
    direct?: number
    forced?: boolean
    known?: number
    count?: number
    seed?: number
  } = {},
): TelemetryEvent {
  const random = mulberry32(options.seed ?? 1234),
    collector = new TelemetryCollector()
  for (const unknown of [false, true]) {
    for (let index = 0; index < (options.count ?? 2000); index++) {
      const actionId = (index % 2) + 1,
        potency = actionId === 1 ? 200 : 400
      const critical =
        (unknown && options.forced) || random() < 0.2 + (options.known ?? 0) + (unknown ? (options.critical ?? 0) : 0)
      const direct = random() < 0.3 + (unknown ? (options.direct ?? 0) : 0)
      const modifier = unknown
        ? (options.damage ?? 0) + (actionId === 2 ? (options.magic ?? 0) : 0) + (options.potency ?? 0) / potency
        : 0
      collector.add({
        casterId: 1,
        targetId: 2,
        classJob: 25,
        level: 100,
        actionId,
        damageType: actionId === 1 ? 'physical' : 'magic',
        unknownStatuses: unknown ? [{ id: 40001, param: 0 }] : [],
        critical: { hit: Boolean(critical), addedRate: options.known ?? 0 },
        direct: { hit: direct, addedRate: 0 },
        normal: critical || direct ? null : { value: 100 * (1 + modifier) * (0.95 + random() * 0.1), potency },
      })
    }
  }
  return {
    eventId: '6b1d0c4e-2f5a-4d7e-9a35-0c4f7b9e2a11',
    type: 'combat.unknown-status',
    schemaVersion: 1,
    producerVersion: '0.4.0',
    payload: {
      modelVersion: '7.57',
      opcodeVersion: '7.57',
      dataGameVersion: 'synthetic',
      territoryId: 123,
      ...collector.finish(),
    },
  }
}
const result = (event: TelemetryEvent) => {
  const read = readEvents([event])
  expect(read.skipped.invalidPayload).toBe(0)
  return analyze(read.events, actionTypes, read.skipped)
}
const contains = (estimate: { value: number; low: number; high: number } | null, truth: number) => {
  expect(estimate).not.toBeNull()
  expect(estimate!.low).toBeLessThanOrEqual(truth)
  expect(estimate!.high).toBeGreaterThanOrEqual(truth)
}
describe('telemetry statistics', () => {
  it('estimates unconditional damage and narrows its interval as samples increase', () => {
    const small = result(synthetic({ damage: 0.08, count: 200 })).single[0].damage!
    const large = result(synthetic({ damage: 0.08 })).single[0].damage!
    contains(large, 0.08)
    expect(large.value).toBeCloseTo(0.08, 2)
    expect(large.high - large.low).toBeLessThan(small.high - small.low)
  })
  it('shows magic-only damage and fixed potency bonuses in the action details', () => {
    const magic = result(synthetic({ magic: 0.1 })).actions
    contains(magic.find((row) => row.actionId === 1)!.damage, 0)
    contains(magic.find((row) => row.actionId === 2)!.damage, 0.1)
    const potency = result(synthetic({ potency: 40 })).actions
    for (const row of potency) {
      expect(row.averagePotency).toBe(row.actionId === 1 ? 200 : 400)
      contains(row.damage, 40 / row.averagePotency!)
    }
  })
  it.each([{ critical: 0.1 }, { direct: 0.2 }, { forced: true }])('estimates rate differences for %j', (options) => {
    const summary = result(synthetic(options)).single[0]
    if ('critical' in options) contains(summary.critical, 0.1)
    if ('direct' in options) contains(summary.direct, 0.2)
    if ('forced' in options) {
      expect(summary.damage).toBeNull()
      contains(summary.critical, 0.8)
      expect(summary.normalCount).toBe(0)
    }
  })
  it('subtracts known probability additions and does not label an effect', () => {
    const summary = result(synthetic({ critical: 0.1, known: 0.1 })).single[0]
    contains(summary.critical, 0.1)
    const none = result(synthetic()).single[0]
    contains(none.damage, 0)
    contains(none.critical, 0)
    contains(none.direct, 0)
    expect(JSON.stringify(none)).not.toMatch(/suggestion|possibleType|modifierType/)
  })
  it('pairs each profile once per combination, independently of the number of actions', () => {
    const one = synthetic({ critical: 0.1 })
    const original = result(one).single[0].critical
    const observation = one.payload.observations[0]
    // Split one action into two observations without changing any sufficient statistic.
    const first = structuredClone(observation),
      second = structuredClone(observation)
    for (const key of ['critical', 'direct'] as const) {
      first[key] = { hits: 0, successes: 0, addedRate: 0 }
      second[key] = observation[key]
    }
    first.actionId = 3
    one.payload.observations.splice(0, 1, first, second)
    expect(result(one).single[0].critical).toEqual(original)
  })
  it('returns null for missing controls and keeps combinations intact', () => {
    const event = synthetic({ forced: true })
    event.payload.profiles[0].critical = { hits: 0, successes: 0, addedRate: 0 }
    for (const observation of event.payload.observations) observation.unknownStatuses.push({ id: 40002, param: 2 })
    const output = result(event)
    expect(output.single).toEqual([])
    expect(output.actions).toEqual([])
    expect(output.combinations[0]).toMatchObject({
      critical: null,
      damage: null,
      unknownStatuses: [
        { id: 40001, param: 0 },
        { id: 40002, param: 2 },
      ],
    })
    expect(JSON.stringify(output)).not.toContain('NaN')
  })
  it('merges events with inverse variance weights and counts distinct events', () => {
    const a = synthetic({ damage: 0.08 }),
      b = structuredClone(a)
    b.eventId = '6b1d0c4e-2f5a-4d7e-9a35-0c4f7b9e2a12'
    const before = result(a).single[0].damage!
    const after = analyze([a, b], actionTypes).single[0]
    expect(after.events).toBe(2)
    expect(after.damage!.value).toBeCloseTo(before.value, 12)
    expect(after.damage!.high - after.damage!.low).toBeLessThan(before.high - before.low)
  })
})
describe('event reader and command line', () => {
  it('deduplicates pages and explains ignored types, versions, payloads and model versions', () => {
    const event = synthetic()
    const read = readEvents(
      [
        event,
        structuredClone(event),
        { type: 'other' },
        { type: event.type, schemaVersion: 2 },
        { ...event, payload: {} },
      ],
      '7.57',
    )
    expect(read.events).toHaveLength(1)
    expect(read.skipped).toEqual({
      otherType: 1,
      otherVersion: 1,
      invalidPayload: 1,
      duplicate: 1,
      otherModelVersion: 0,
    })
    expect(readEvents([event], 'other').skipped.otherModelVersion).toBe(1)
    const old = structuredClone(event) as unknown as { payload: Record<string, unknown> }
    delete old.payload.profiles
    expect(readEvents([old]).skipped.invalidPayload).toBe(1)
    expect(readEvents([fixture.event]).events).toHaveLength(1)
  })
  it.each([
    (event: TelemetryEvent) => {
      event.payload.observations[0].profile = 1
    },
    (event: TelemetryEvent) => {
      event.payload.profiles.push(structuredClone(event.payload.profiles[0]))
    },
    (event: TelemetryEvent) => {
      event.payload.observations[0].critical.successes = Number.MAX_SAFE_INTEGER
    },
    (event: TelemetryEvent) => {
      event.payload.observations[0].direct.addedRate = Number.POSITIVE_INFINITY
    },
    (event: TelemetryEvent) => {
      event.payload.observations[0].normal.count = 0
    },
    (event: TelemetryEvent) => {
      event.payload.observations[0].normal.potencySum = 0
    },
    (event: TelemetryEvent) => {
      event.payload.observations[0].unknownStatuses.reverse()
      event.payload.observations[0].unknownStatuses.push({ id: 1, param: 0 })
    },
    (event: TelemetryEvent) => {
      Object.assign(event.payload.observations[0], { casterId: 1 })
    },
    (event: TelemetryEvent) => {
      Object.assign(event.payload.profiles[0], { critical: null })
    },
  ])('rejects invalid payloads', (change) => {
    const event = synthetic()
    change(event)
    expect(readEvents([event]).skipped.invalidPayload).toBe(1)
  })
  it('prints Markdown from a page and JSON from event arrays', () => {
    const event = synthetic()
    const files: Record<string, string> = {
      page: JSON.stringify({ items: [event], nextCursor: null }),
      array: JSON.stringify([event]),
    }
    const markdown = runCli(['page'], (path) => files[path], actionTypes)
    expect(markdown.exitCode).toBe(0)
    expect(markdown.stdout).toContain('单状态各技能明细')
    expect(markdown.stdout).toContain('40001:0')
    expect(markdown.stdout).toContain('数据局限')
    const json = runCli(['--json', 'array', 'page'], (path) => files[path], new Map())
    expect(json.exitCode).toBe(0)
    expect(JSON.parse(json.stdout).skipped.duplicate).toBe(1)
    expect(JSON.parse(json.stdout).actions[0].category).toBeNull()
    expect(formatMarkdown(JSON.parse(json.stdout))).toContain('未知')
    expect(runCli(['--model-version', 'other', 'page'], (path) => files[path], actionTypes).stdout).toContain(
      'otherModelVersion=1',
    )
  })
  it('names bad files and rejects bad input and arguments with a nonzero exit code', () => {
    for (const source of ['{', '{}', 'null']) {
      const output = runCli(['broken.json'], () => source, actionTypes)
      expect(output.exitCode).toBe(1)
      expect(output.stderr).toContain('broken.json:')
      expect(output.stdout).toBe('')
    }
    for (const args of [[], ['--bad'], ['--model-version']])
      expect(runCli(args, () => '[]', actionTypes).exitCode).toBe(1)
  })
})
