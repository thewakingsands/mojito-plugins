import { Ledger, NO_CONTRIBUTION } from './ledger.js'
import type { Summary } from './model.js'
/** The stored rows remain independent; grouping never changes totals or the live encounter selection. */
export function displaySummary(summary: Summary | null, mergePets: boolean): Summary | null {
  if (!summary || !mergePets) return summary
  const ledger = new Ledger(new Map(summary.rows.map((row) => [row.actor.id, row.actor])))
  for (const row of summary.rows) ledger.restore(row)
  ledger.quality.clear()
  for (const reason of summary.quality) ledger.quality.add(reason)
  Object.assign(ledger.diagnostics, summary.diagnostics)
  // undefined: saved before rDPS
  ledger.contributionUnavailable =
    summary.contributionUnavailable === undefined ? NO_CONTRIBUTION : summary.contributionUnavailable
  const rows = ledger.summary(summary.startAt, summary.endAt, true, summary.durationMs)
  for (const row of rows)
    for (const size of [10, 30, 60]) {
      const source = summary.rows.find((item) => (item.actor.ownerKey ?? item.actor.key) === row.actor.key)
      if (source?.metrics[`last${size}OwnerDps`]) row.metrics[`last${size}Dps`] = source.metrics[`last${size}OwnerDps`]
    }
  return { ...summary, rows }
}
