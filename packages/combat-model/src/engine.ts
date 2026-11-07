import { DamageAttributor } from './attribution/attributor.js'
import { outputId } from './constants.js'
import type { PeriodicDefs } from './defs.js'
import type {
  AttributionDeltaEvent,
  DamageAttributionEvent,
  PeriodicRevisionEvent,
  PeriodicTickEvent,
  PotencySampleEvent,
} from './events.js'
import type { CombatInput } from './input.js'
import type { CombatOutput, PeriodicTick } from './output.js'
import type { CalibrationSamples } from './periodic/calibration.js'
import { PeriodicEstimator } from './periodic/estimator.js'
import { type CombatWorld, MemoryWorld } from './world.js'

/** A window of damage closes after this long without an effect, a tick, a death or a cast */
const WINDOW_QUIET = 10000

type Result =
  | PeriodicTickEvent
  | PeriodicRevisionEvent
  | PotencySampleEvent
  | DamageAttributionEvent
  | AttributionDeltaEvent

/**
 * Splits the ticks of the over time effects among their statuses and sources, splits the damage of the players among
 * them and the modifiers of others, and takes potency samples. Both splits are done again when a window of damage
 * closes: after ten quiet seconds, or with the zone.
 *
 * A world other than MemoryWorld is kept by the caller, before each input reaches the engine.
 */
export class CombatEngine {
  private readonly periodic: PeriodicEstimator
  private readonly attributor: DamageAttributor
  /** The time of the last input that keeps the window open; null without an open window */
  private windowTime: number | null = null

  constructor(
    readonly defs: PeriodicDefs,
    readonly world: CombatWorld = new MemoryWorld(),
  ) {
    this.periodic = new PeriodicEstimator(defs, world)
    this.attributor = new DamageAttributor(this.periodic, world)
  }

  /** The samples of the damage per potency of each caster since the zone changed */
  get calibration(): CalibrationSamples {
    return this.periodic.calibration
  }

  /**
   * Handles an input. An actor input only changes the world. Any other first lets the pending ticks expire and the
   * window close when the input is past them, then the input takes effect.
   * @returns The ticks, then the splits of their damage; for an effect then its potency samples and the splits of its
   *   hits. A window that closes gives the changes of its splits before the revision of its ticks.
   */
  handle(input: CombatInput): CombatOutput[] {
    if (input.type === 'actor') {
      this.applyWorld(input)
      return []
    }
    if (input.type === 'playerStats') this.periodic.setPlayerStats(input.actor, input.criticalHit, input.directHit)
    const closes = input.type === 'zone' || (this.windowTime !== null && input.time - this.windowTime > WINDOW_QUIET)
    const output: Result[] = closes ? this.close(input.time) : []
    // The statuses read the slots after they changed
    if (input.type === 'statuses') this.applyWorld(input)
    output.push(...this.withSplits(this.periodic.handleEvent(input)))
    switch (input.type) {
      case 'effect':
        output.push(...this.periodic.takeSamples(), ...this.attributor.handleEffect(input))
        this.windowTime = input.time
        break
      case 'tick':
      case 'death':
      case 'cast':
        this.windowTime = input.time
        break
      case 'zone':
        this.attributor.changeZone()
        this.applyWorld(input)
        break
    }
    return output.map(toOutput)
  }

  /** The time drain should be called at; null when nothing waits for time */
  nextDeadline(): number | null {
    const pending = this.periodic.nextDeadline()
    return this.windowTime === null ? pending : Math.min(this.windowTime + WINDOW_QUIET + 1, pending ?? Infinity)
  }

  /** Lets the time pass without an input, so that a quiet end also expires its ticks and closes its window */
  drain(now: number): CombatOutput[] {
    const output = this.withSplits(this.periodic.drainExpired(now))
    if (this.windowTime !== null && now - this.windowTime > WINDOW_QUIET) output.push(...this.close(now))
    return output.map(toOutput)
  }

  private applyWorld(input: CombatInput): void {
    if (this.world instanceof MemoryWorld) this.world.handle(input)
  }

  /** The ticks, then the splits of their damage */
  private withSplits(ticks: readonly PeriodicTickEvent[]): Result[] {
    return [...ticks, ...ticks.flatMap((tick) => this.attributor.handleTick(tick))]
  }

  /**
   * Closes the window: the estimator splits its pending ticks and every summed tick of the window again, then the
   * attributor splits the damage of the window again
   */
  private close(time: number): Result[] {
    const periodic = this.periodic.closeBattle(time)
    const ticks = periodic.filter((item): item is PeriodicTickEvent => item.eventType === 'PeriodicTickEvent')
    const revision =
      periodic.find((item): item is PeriodicRevisionEvent => item.eventType === 'PeriodicRevisionEvent') ?? null
    const output = this.withSplits(ticks)
    this.windowTime = null
    const delta = this.attributor.closeWindow(revision, time)
    if (delta) output.push(delta)
    if (revision) output.push(revision)
    return output
  }
}

function tickOf(tick: PeriodicTickEvent): PeriodicTick {
  return {
    tickId: tick.tickId,
    occurredAt: tick.eventTime,
    target: outputId(tick.combatant),
    isHeal: tick.isHeal,
    statusId: tick.statusId,
    total: tick.total,
    unknown: tick.unknown,
    confirmed: tick.confirmed,
    phase: tick.phase,
    shares: tick.shares.map(({ sourceId, statusId, amount, basis }) => ({
      sourceId: outputId(sourceId),
      statusId,
      amount,
      basis,
    })),
  }
}

const partsOf = (parts: readonly { statusId: number; sourceId: number; amount: number }[]) =>
  parts.map(({ statusId, sourceId, amount }) => ({ statusId, sourceId: outputId(sourceId), amount }))

function toOutput(result: Result): CombatOutput {
  switch (result.eventType) {
    case 'PeriodicTickEvent':
      return { type: 'periodicTick', data: tickOf(result) }
    case 'PeriodicRevisionEvent':
      return { type: 'periodicRevision', data: { ticks: result.ticks.map(tickOf) } }
    case 'PotencySampleEvent':
      return {
        type: 'potencySample',
        data: {
          casterId: outputId(result.caster),
          targetId: outputId(result.target),
          actionId: result.action,
          sequence: result.sequence,
          amount: result.amount,
          potency: result.potency,
          multiplier: result.multiplier,
          factors: result.factors.map(({ statusId, sourceId, holder, value }) => ({
            statusId,
            sourceId: outputId(sourceId),
            holder,
            value,
          })),
          critical: result.critical,
          direct: result.direct,
        },
      }
    case 'DamageAttributionEvent':
      return {
        type: 'damageAttributed',
        data: {
          id: result.id,
          origin:
            result.origin.type === 'action'
              ? { type: 'action', actionId: result.origin.action, sequence: result.origin.sequence }
              : { type: 'tick', tickId: result.origin.tickId, statusId: result.origin.statusId },
          attackerId: outputId(result.attacker),
          actorId: outputId(result.actor),
          targetId: outputId(result.target),
          amount: result.amount,
          retained: result.retained,
          contributions: partsOf(result.contributions),
        },
      }
    case 'AttributionDeltaEvent':
      return {
        type: 'attributionRevision',
        data: {
          records: result.records.map((record) => ({
            id: record.id,
            tickId: record.tickId,
            actorId: outputId(record.actor),
            origin:
              record.origin.type === 'action'
                ? { type: 'action', actionId: record.origin.action }
                : { type: 'tick', statusId: record.origin.statusId },
            contributions: partsOf(record.contributions),
          })),
        },
      }
  }
}
