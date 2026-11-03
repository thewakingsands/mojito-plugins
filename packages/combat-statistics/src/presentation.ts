import { metric, type Summary } from './model.js'

/** Supplied by the settlement model, never inferred from the latest published event. */
export interface PresentationAnchor {
  encounterId: string
  source: string
  factDurationMs: number
  lastFactSourceAt: number
}

export class Presentation {
  private previous: { id: string; source: string; durationMs: number } | null = null

  reset() {
    this.previous = null
  }

  project(
    facts: Summary | null,
    anchor: PresentationAnchor | null,
    clock: { now: number | null; paused: boolean },
    inCombat: boolean | null,
  ): { summary: Summary | null; changed: boolean } {
    const previous = this.previous
    if (
      !facts ||
      facts.ended ||
      inCombat === false ||
      !anchor ||
      anchor.encounterId !== facts.id ||
      anchor.source !== facts.source ||
      clock.now === null ||
      !Number.isFinite(clock.now)
    ) {
      this.reset()
      return { summary: facts, changed: previous !== null }
    }
    const same = previous?.id === facts.id && previous.source === facts.source
    const durationMs = clock.paused
      ? Math.max(anchor.factDurationMs, same ? previous.durationMs : anchor.factDurationMs)
      : Math.max(
          anchor.factDurationMs + Math.max(0, clock.now - anchor.lastFactSourceAt),
          same ? previous.durationMs : 0,
        )
    this.previous = { id: facts.id, source: facts.source, durationMs }
    const changed = !same || previous.durationMs !== durationMs
    if (durationMs === facts.durationMs) return { summary: facts, changed }
    const seconds = durationMs / 1000
    return {
      changed,
      summary: {
        ...facts,
        durationMs,
        rows: facts.rows.map((row) => ({
          ...row,
          metrics: {
            ...row.metrics,
            encDps: metric(
              seconds > 0 ? row.totals.damage / seconds : null,
              row.metrics.damage.quality,
              row.metrics.damage.reason,
            ),
            encHps: metric(
              seconds > 0 ? row.totals.healing / seconds : null,
              row.metrics.reportedHealing.quality,
              row.metrics.reportedHealing.reason,
            ),
          },
        })),
      },
    }
  }
}
