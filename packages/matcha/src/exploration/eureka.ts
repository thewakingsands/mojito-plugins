import type { EurekaCatalog, EurekaEntry, EurekaState, FateObservation } from './eureka-types.js'
import { EUREKA_RULES, EUREKA_TERRITORIES, type EurekaRule } from './rules.js'
import type { ExplorationContext } from './types.js'
import { conditionWindow } from './weather.js'

interface Timing {
  start: number
  end: number
  packetSeq: number
  timestamp: number
}

interface Round {
  firstObservedAt: number | null
  lastSequence: number
  lastTimestamp: number
  minimumStartTime: number
  endedAt: number | null
  progress: number | null
  timing: Timing | null
}

function timingFrom(event: Extract<FateObservation, { kind: 'info' }>): Timing | null {
  if (
    !Number.isInteger(event.startTimeSeconds) ||
    event.startTimeSeconds <= 0 ||
    !Number.isInteger(event.durationSeconds) ||
    event.durationSeconds <= 0
  )
    return null
  const offset = event.serverToSourceOffsetMs ?? 0
  if (!Number.isFinite(offset)) return null
  const start = event.startTimeSeconds * 1000 + offset
  const end = start + event.durationSeconds * 1000
  if (
    !Number.isFinite(end) ||
    Math.abs(end) > Number.MAX_SAFE_INTEGER ||
    start < 0 ||
    start > event.timestamp ||
    end <= event.timestamp
  )
    return null
  return { start, end, packetSeq: event.packetSeq, timestamp: event.timestamp }
}

function matchesRound(timing: Timing, round: Round): boolean {
  return (
    round.firstObservedAt !== null &&
    timing.start >= round.minimumStartTime &&
    timing.start <= round.firstObservedAt &&
    timing.end > round.firstObservedAt &&
    (round.timing === null || round.timing.start === timing.start)
  )
}

export class EurekaTracker {
  private readonly rounds = new Map<number, Round>()
  private readonly pendingTiming = new Map<number, Timing>()

  reset(): void {
    this.rounds.clear()
    this.pendingTiming.clear()
  }

  observe(event: FateObservation): boolean {
    if (
      !EUREKA_RULES.some((rule) => rule.fateId === event.fateId) ||
      !Number.isFinite(event.timestamp) ||
      event.timestamp < 0 ||
      !Number.isSafeInteger(event.packetSeq) ||
      event.packetSeq < 0
    )
      return false
    const existing = this.rounds.get(event.fateId)
    const pending = this.pendingTiming.get(event.fateId)
    if (
      event.packetSeq <= Math.max(existing?.lastSequence ?? -1, pending?.packetSeq ?? -1) ||
      event.timestamp < (existing?.lastTimestamp ?? 0)
    )
      return false

    if (event.kind === 'info') {
      const timing = timingFrom(event)
      if (!timing) return false
      if (existing && existing.endedAt === null) {
        if (!matchesRound(timing, existing)) return false
        existing.timing = timing
        existing.lastSequence = event.packetSeq
        existing.lastTimestamp = event.timestamp
      } else {
        if (existing?.endedAt !== undefined && existing.endedAt !== null && timing.start < existing.endedAt)
          return false
        this.pendingTiming.set(event.fateId, timing)
      }
      return true
    }

    if (event.kind === 'progress' && (!Number.isInteger(event.progress) || event.progress < 0 || event.progress > 100))
      return false
    const startsNextRound =
      existing &&
      event.kind !== 'end' &&
      (existing.endedAt !== null ||
        (event.kind === 'start' && existing.timing !== null && event.timestamp >= existing.timing.end))
    const round: Round =
      !existing || startsNextRound
        ? {
            firstObservedAt: event.kind === 'end' ? null : event.timestamp,
            lastSequence: event.packetSeq,
            lastTimestamp: event.timestamp,
            minimumStartTime: existing?.endedAt ?? existing?.timing?.end ?? 0,
            endedAt: null,
            progress: null,
            timing: null,
          }
        : existing
    round.lastSequence = event.packetSeq
    round.lastTimestamp = event.timestamp
    if (event.kind === 'end') {
      round.endedAt ??= event.timestamp
      this.pendingTiming.delete(event.fateId)
    } else {
      if (event.kind === 'progress') round.progress = event.progress
      if (pending && matchesRound(pending, round)) round.timing = pending
      this.pendingTiming.delete(event.fateId)
    }
    this.rounds.set(event.fateId, round)
    return true
  }

  state(options: {
    context: ExplorationContext
    catalog: EurekaCatalog | null
    available: boolean
    reason?: string | null
  }): EurekaState {
    const { context, catalog, available } = options
    const territoryId = context.territoryId
    const base = { context, reason: null, mapId: catalog?.mapId ?? null, entries: [] }
    if (territoryId === null) return { ...base, status: 'waiting', reason: '等待区域资料' }
    if (!(EUREKA_TERRITORIES as readonly number[]).includes(territoryId)) return { ...base, status: 'outside' }
    if (!available) return { ...base, status: 'unavailable', reason: options.reason ?? 'FATE 数据不可用' }
    if (!catalog) return { ...base, status: 'waiting', reason: '等待客户端资料' }
    const now = context.clock.now
    const sourceTime =
      typeof now === 'number' &&
      Number.isFinite(now) &&
      now >= 0 &&
      context.clock.base !== null &&
      context.clock.source !== null
        ? now
        : null
    const entries: EurekaEntry[] = []
    for (const rule of EUREKA_RULES) {
      if (rule.territoryId !== territoryId) continue
      const fate = catalog.fates.find((entry) => entry.id === rule.fateId)
      if (!fate) continue
      const round = this.rounds.get(rule.fateId)
      const timing = round?.timing
      const referenceAt = timing?.start ?? round?.firstObservedAt ?? null
      const durationMs = referenceAt === null ? null : rule.respawnMinutes * 60_000
      const readyAt = referenceAt !== null && durationMs !== null ? referenceAt + durationMs : null
      const activityEndsAt = timing?.end ?? null
      entries.push({
        fateId: rule.fateId,
        name: fate.name,
        position: fate.position,
        activity: !round
          ? 'unknown'
          : round.endedAt !== null
            ? 'ended'
            : activityEndsAt !== null && sourceTime !== null && sourceTime >= activityEndsAt
              ? 'unconfirmed'
              : 'active',
        progress: round?.progress ?? null,
        activityEndsAt,
        cooldown: {
          basis: referenceAt === null ? null : timing ? 'fate-start' : 'first-observed',
          referenceAt,
          durationMs,
          readyAt,
        },
        conditions: this.conditions(rule, catalog, sourceTime, readyAt),
      })
    }
    return { ...base, status: 'ready', reason: sourceTime === null ? '源时间不可用' : null, entries }
  }

  private conditions(
    rule: EurekaRule,
    catalog: EurekaCatalog,
    now: number | null,
    readyAt: number | null,
  ): EurekaEntry['conditions'] {
    const weatherName = rule.weatherId === null ? null : (catalog.weatherNames.get(rule.weatherId) ?? null)
    const known = now !== null && (rule.weatherId === null || weatherName !== null)
    const environmentWindow = known ? conditionWindow(now, rule.weatherId, rule.nightOnly, catalog.weatherRates) : null
    const estimatedWindow =
      known && readyAt !== null
        ? conditionWindow(Math.max(now, readyAt), rule.weatherId, rule.nightOnly, catalog.weatherRates)
        : null
    return {
      weatherId: rule.weatherId,
      weatherName,
      nightOnly: rule.nightOnly,
      status: environmentWindow === null ? 'unknown' : environmentWindow.opensAt <= (now ?? -1) ? 'open' : 'waiting',
      environmentWindow,
      estimatedWindow,
      otherConditionsUnknown: true,
    }
  }
}
