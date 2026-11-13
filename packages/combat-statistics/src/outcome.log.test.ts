import { expect, it } from 'vitest'
import { records } from './log/records.test-helper.js'
import { replay } from './log/replay.js'

/**
 * The log of a fight the game left combat 1.9 seconds before it reported the deaths of the bosses, which sat at 1 HP
 * until then. It holds player names, so it stays out of the repository and this test reads it from a path.
 */
const LOG = process.env.MOJITO_LATE_DEATH_LOG
const DURATION_MS = 383_000

it.skipIf(!LOG)(
  'is a kill when the bosses die after the game left combat',
  async () => {
    const all = await records(LOG!)
    const starts = new Map<string, number>()
    for (const record of all) if (record.kind === 'fightStart') starts.set(record.id, record.startAt)
    const end = all.findIndex(
      (record) =>
        record.kind === 'fightEnd' &&
        record.reason === 'outOfCombat' &&
        Math.abs(record.endAt - (starts.get(record.id) ?? -Infinity) - DURATION_MS) < 1500,
    )
    const fight = all[end]
    if (fight?.kind !== 'fightEnd') throw new Error('the log has no fight that left combat after about 6:23')
    const visitStart = all.slice(0, end).findLastIndex((record) => record.kind === 'visitStart')
    const visitEnd = all.findIndex((record, i) => i > end && record.kind === 'visitEnd')
    const summaries = await replay(all.slice(visitStart, visitEnd < 0 ? undefined : visitEnd + 1))
    const summary = summaries.find((item) => item.id === fight.id)
    expect(summary).toMatchObject({ reason: 'outOfCombat', outcome: { result: 'kill' } })
  },
  60_000,
)
