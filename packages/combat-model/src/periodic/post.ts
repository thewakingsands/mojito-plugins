import type { PeriodicRevisionEvent, PeriodicTickEvent } from '../events.js'
import {
  type PeriodicEstimator,
  type Snapshot,
  type SnapshotPrior,
  sourceKey,
  splitTick,
  type TickRecord,
} from './estimator.js'
import { GaussianState, removeTick } from './gaussian.js'

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

/**
 * Splits the summed ticks of a battle again with what the whole battle showed: the priors take every sample since
 * the zone changed, the state learns from every confirmed tick, and each confirmed tick is split without what it
 * taught the state.
 * @returns null for a battle without summed ticks
 */
export function reviseBattle(
  estimator: PeriodicEstimator,
  records: readonly TickRecord[],
  eventTime: number,
): PeriodicRevisionEvent | null {
  if (records.length === 0) return null

  const priors = new Map<Snapshot, SnapshotPrior | null>()
  for (const { members } of records) {
    for (const snapshot of members) {
      if (!priors.has(snapshot)) priors.set(snapshot, estimator.priorWithAllSamples(snapshot))
    }
  }
  const priorOf = (snapshot: Snapshot) => priors.get(snapshot) ?? null

  const state = new GaussianState()
  for (const [snapshot, prior] of priors) {
    if (prior) state.addSnapshot(snapshot.id, sourceKey(snapshot))
  }
  const membersOf = (snapshots: readonly Snapshot[]) =>
    snapshots.map((snapshot) => ({ id: snapshot.id, prior: (priorOf(snapshot) as SnapshotPrior).mean }))
  const hasPriors = (snapshots: readonly Snapshot[]) =>
    snapshots.length > 0 && snapshots.every((snapshot) => priorOf(snapshot))
  const noiseOf = (snapshots: readonly Snapshot[]) =>
    snapshots.map((snapshot) => (priorOf(snapshot) as SnapshotPrior).variance)

  for (const { event, members } of records) {
    if (event.confirmed && hasPriors(members)) state.update(membersOf(members), event.total, sum(noiseOf(members)))
  }

  const ticks = records.map(({ event, members }): PeriodicTickEvent => {
    const withPriors = hasPriors(members)
    const block = withPriors ? state.block(membersOf(members)) : null
    const noise = withPriors ? noiseOf(members) : []
    const split = splitTick(members, event.total, event.confirmed, block, noise, (value) =>
      removeTick(value, sum(noise), event.total),
    )
    return {
      ...event,
      phase: 'post',
      unknown: split.unknown,
      shares: estimator.shares(members, split, priorOf),
    }
  })
  return { eventType: 'PeriodicRevisionEvent', eventTime, ticks }
}
