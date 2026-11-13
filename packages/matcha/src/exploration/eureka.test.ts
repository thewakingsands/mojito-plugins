import { describe, expect, it, vi } from 'vitest'
import { EurekaTracker } from './eureka.js'
import type { EurekaCatalog, FateObservation } from './eureka-types.js'
import { EUREKA_RULES } from './rules.js'
import type { ExplorationContext } from './types.js'

const T = 1_700_000_000_000
function context(now: number | null = T, territoryId: number | null = 732): ExplorationContext {
  return {
    sessionId: 'synthetic',
    characterGeneration: 1,
    clockGeneration: 1,
    zoneEpoch: 1,
    catalogRevision: 1,
    territoryId,
    clock: { now, base: 'host-monotonic-unix', generation: 1, source: 'live', paused: false },
  }
}
function catalog(territoryId = 732): EurekaCatalog {
  return {
    mapId: 414,
    fates: EUREKA_RULES.filter((rule) => rule.territoryId === territoryId).map((rule) => ({
      id: rule.fateId,
      name: `NM ${rule.fateId}`,
      position: null,
    })),
    weatherRates: [
      { weatherId: 2, rate: 30 },
      { weatherId: 6, rate: 30 },
      { weatherId: 8, rate: 30 },
      { weatherId: 15, rate: 10 },
    ],
    weatherNames: new Map([[6, 'Gales']]),
  }
}
function event(kind: FateObservation['kind'], packetSeq: number, timestamp = T, fateId = 1332): FateObservation {
  return kind === 'info'
    ? { kind, packetSeq, timestamp, fateId, startTimeSeconds: (T - 60_000) / 1000, durationSeconds: 1200 }
    : kind === 'progress'
      ? { kind, packetSeq, timestamp, fateId, progress: 45 }
      : kind === 'end'
        ? { kind, packetSeq, timestamp, fateId, extra: 0 }
        : { kind, packetSeq, timestamp, fateId }
}
function entry(tracker: EurekaTracker, now: number | null = T, fateId = 1332, territoryId = 732) {
  const value = tracker
    .state({ context: context(now, territoryId), catalog: catalog(territoryId), available: true })
    .entries.find((value) => value.fateId === fateId)
  if (!value) throw new Error('Missing fixture entry')
  return value
}

describe('local Eureka NM evidence', () => {
  it('includes only four islands with source-defined special cooldowns', () => {
    expect(EUREKA_RULES).toHaveLength(67)
    expect(
      EUREKA_RULES.filter((rule) => rule.respawnMinutes !== 120).map((rule) => [rule.fateId, rule.respawnMinutes]),
    ).toEqual([
      [1424, 20],
      [1422, 20],
    ])
    expect(EUREKA_RULES.some((rule) => [1367, 1368, 1407, 1408, 1425].includes(rule.fateId))).toBe(false)
  })
  it('starts with unknown cooldown but independently evaluates conditions', () => {
    const value = entry(new EurekaTracker())
    expect(value.activity).toBe('unknown')
    expect(value.cooldown).toEqual({ basis: null, referenceAt: null, durationMs: null, readyAt: null })
    expect(value.conditions.environmentWindow).not.toBeNull()
    expect(value.conditions.estimatedWindow).toBeNull()
    expect(value.conditions.otherConditionsUnknown).toBe(true)
  })
  it('uses first progress without extending the origin on repeated starts or progress', () => {
    const tracker = new EurekaTracker()
    tracker.observe(event('progress', 1))
    tracker.observe(event('start', 2, T + 1000))
    tracker.observe(event('progress', 3, T + 2000))
    expect(entry(tracker).cooldown).toEqual({
      basis: 'first-observed',
      referenceAt: T,
      durationMs: 7_200_000,
      readyAt: T + 7_200_000,
    })
    expect(entry(tracker).activityEndsAt).toBeNull()
    expect(entry(tracker).progress).toBe(45)
  })
  it('matches early and late FateInfo against the observed round', () => {
    for (const infoFirst of [true, false]) {
      const tracker = new EurekaTracker()
      tracker.observe(event(infoFirst ? 'info' : 'start', 1))
      tracker.observe(event(infoFirst ? 'start' : 'info', 2, T + 1000))
      expect(entry(tracker).cooldown.basis).toBe('fate-start')
      expect(entry(tracker).cooldown.referenceAt).toBe(T - 60_000)
      expect(entry(tracker).activityEndsAt).toBe(T + 1_140_000)
    }
  })
  it.each([600_000, -600_000])('converts server timestamps to the source clock with offset %i', (offset) => {
    const tracker = new EurekaTracker()
    tracker.observe(event('start', 1))
    expect(
      tracker.observe({
        kind: 'info',
        fateId: 1332,
        packetSeq: 2,
        timestamp: T + 1000,
        startTimeSeconds: (T - 60_000 - offset) / 1000,
        durationSeconds: 1200,
        serverToSourceOffsetMs: offset,
      }),
    ).toBe(true)
    expect(entry(tracker).cooldown.referenceAt).toBe(T - 60_000)
    expect(entry(tracker).activityEndsAt).toBe(T + 1_140_000)
  })

  it('preserves high-resolution source offsets and rejects non-finite conversion', () => {
    const tracker = new EurekaTracker()
    tracker.observe(event('start', 1, T + 0.125))
    const info = {
      kind: 'info' as const,
      fateId: 1332,
      packetSeq: 2,
      timestamp: T + 1000.25,
      startTimeSeconds: (T - 60_000) / 1000,
      durationSeconds: 1200,
      serverToSourceOffsetMs: 0.25,
    }
    expect(tracker.observe({ ...info, serverToSourceOffsetMs: Number.NaN })).toBe(false)
    expect(tracker.observe(info)).toBe(true)
    expect(entry(tracker).cooldown.referenceAt).toBe(T - 60_000 + 0.25)
    expect(entry(tracker).activityEndsAt).toBe(T + 1_140_000 + 0.25)
  })

  it('does not construct a cooldown from an isolated end', () => {
    const tracker = new EurekaTracker()
    tracker.observe(event('end', 1))
    tracker.observe(event('info', 2, T + 1000))
    expect(entry(tracker).activity).toBe('ended')
    expect(entry(tracker).cooldown.readyAt).toBeNull()
  })
  it('stops at unconfirmed after the deadline and preserves explicit end evidence', () => {
    const tracker = new EurekaTracker()
    tracker.observe(event('start', 1))
    tracker.observe(event('info', 2))
    expect(entry(tracker, T + 1_140_000).activity).toBe('unconfirmed')
    tracker.observe(event('end', 3, T + 1_150_000))
    expect(entry(tracker, T + 1_150_000).activity).toBe('ended')
    expect(entry(tracker, T + 1_150_000).cooldown.basis).toBe('fate-start')
  })
  it('rejects old sequence, invalid progress and zero, future or expired timings', () => {
    const tracker = new EurekaTracker()
    tracker.observe(event('start', 10))
    expect(tracker.observe(event('end', 9))).toBe(false)
    expect(tracker.observe({ ...event('progress', 11), kind: 'progress', progress: 101 })).toBe(false)
    for (const [startTimeSeconds, durationSeconds] of [
      [0, 1200],
      [T / 1000 + 1, 1200],
      [T / 1000 - 1200, 1200],
      [T / 1000, 0],
      [T / 1000, Number.NaN],
    ]) {
      expect(
        tracker.observe({
          kind: 'info',
          fateId: 1332,
          packetSeq: 11,
          timestamp: T,
          startTimeSeconds: startTimeSeconds!,
          durationSeconds: durationSeconds!,
        }),
      ).toBe(false)
    }
    expect(entry(tracker).activity).toBe('active')
    expect(entry(tracker).cooldown.basis).toBe('first-observed')
  })
  it('starts a new round after end and rejects old FateInfo for it', () => {
    const tracker = new EurekaTracker()
    tracker.observe(event('start', 1))
    tracker.observe(event('info', 2))
    tracker.observe(event('end', 3, T + 30_000))
    tracker.observe(event('start', 4, T + 120_000))
    expect(tracker.observe(event('info', 5, T + 121_000))).toBe(false)
    expect(entry(tracker, T + 121_000).cooldown.referenceAt).toBe(T + 120_000)
    expect(entry(tracker, T + 121_000).activityEndsAt).toBeNull()
  })
  it('starts a fresh round after a timed-out activity without borrowing its timer', () => {
    const tracker = new EurekaTracker()
    tracker.observe(event('start', 1))
    tracker.observe(event('info', 2))
    tracker.observe(event('start', 3, T + 1_200_000))
    expect(entry(tracker, T + 1_200_000).activity).toBe('active')
    expect(entry(tracker, T + 1_200_000).activityEndsAt).toBeNull()
    expect(entry(tracker, T + 1_200_000).cooldown.referenceAt).toBe(T + 1_200_000)
  })

  it('finds a condition window after cooldown and preserves missing weather as unknown', () => {
    const tracker = new EurekaTracker()
    tracker.observe(event('start', 1, T, 1329))
    const value = entry(tracker, T, 1329)
    expect(value.conditions.estimatedWindow?.opensAt).toBeGreaterThanOrEqual(T + 7_200_000)
    const missingWeather = tracker
      .state({ context: context(), catalog: { ...catalog(), weatherRates: null }, available: true })
      .entries.find((value) => value.fateId === 1329)
    expect(missingWeather?.conditions.status).toBe('unknown')
    expect(missingWeather?.conditions.estimatedWindow).toBeNull()
    const unknownClock = context()
    unknownClock.clock = { ...unknownClock.clock, base: null }
    expect(
      tracker.state({ context: unknownClock, catalog: catalog(), available: true }).entries[0]?.conditions.status,
    ).toBe('unknown')
  })

  it('preserves the first end boundary and matches the next round timing', () => {
    const tracker = new EurekaTracker()
    tracker.observe(event('start', 1))
    tracker.observe(event('end', 2, T + 30_000))
    tracker.observe(event('end', 3, T + 60_000))
    tracker.observe(event('start', 4, T + 90_000))
    expect(
      tracker.observe({
        kind: 'info',
        fateId: 1332,
        packetSeq: 5,
        timestamp: T + 90_000,
        startTimeSeconds: (T + 45_000) / 1000,
        durationSeconds: 1200,
      }),
    ).toBe(true)
    expect(entry(tracker, T + 90_000).cooldown.referenceAt).toBe(T + 45_000)
  })

  it('uses 20 minutes for both Hydatos exceptions', () => {
    for (const fateId of [1424, 1422]) {
      const tracker = new EurekaTracker()
      tracker.observe(event('start', 1, T, fateId))
      expect(entry(tracker, T, fateId, 827).cooldown.readyAt).toBe(T + 1_200_000)
    }
  })
  it('clears observations on reset and uses only the supplied source time', () => {
    const tracker = new EurekaTracker()
    tracker.observe(event('start', 1))
    const snapshot = entry(tracker)
    const wallClock = vi.spyOn(Date, 'now').mockReturnValue(T + 99_000_000)
    try {
      expect(entry(tracker)).toEqual(snapshot)
      expect(entry(tracker, T + 5000).conditions.environmentWindow?.opensAt).toBe(T + 5000)
    } finally {
      wallClock.mockRestore()
    }
    expect(entry(tracker, null).conditions.status).toBe('unknown')
    tracker.reset()
    expect(entry(tracker).activity).toBe('unknown')
  })
  it('distinguishes outside, waiting, unavailable and missing client rows', () => {
    const tracker = new EurekaTracker()
    expect(tracker.state({ context: context(T, 1), catalog: null, available: true }).status).toBe('outside')
    expect(tracker.state({ context: context(T, null), catalog: null, available: true }).status).toBe('waiting')
    expect(tracker.state({ context: context(), catalog: null, available: false }).status).toBe('unavailable')
    expect(
      tracker.state({ context: context(), catalog: { ...catalog(), fates: [] }, available: true }).entries,
    ).toEqual([])
    expect(entry(tracker, T, 1329).position).toBeNull()
    expect(entry(tracker, T, 1329).conditions.weatherId).toBe(6)
  })
})
