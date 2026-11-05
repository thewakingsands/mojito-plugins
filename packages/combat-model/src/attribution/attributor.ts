import { actorId, invalidTarget } from '../constants.js'
import type {
  AttributionDelta,
  AttributionDeltaEvent,
  DamageAttributionEvent,
  DamageContribution,
  PeriodicRevisionEvent,
  PeriodicShare,
  PeriodicTickEvent,
  SnapshotModifier,
} from '../events.js'
import type { CombatInput } from '../input.js'
import type { PeriodicEstimator } from '../periodic/estimator.js'
import { criticalMultiplierOf } from '../periodic/prior.js'
import type { CombatWorld } from '../world.js'
import { type AttributionEffect, type AttributionOutcome, type AttributionResult, attribute } from './kernel.js'
import { playerOf } from './owners.js'

type Origin = DamageAttributionEvent['origin']

type Rates = { critical: number; direct: number; criticalMultiplier: number }

/** What a split gave to others; closeWindow sends the change from the realtime one */
type Given = Pick<AttributionResult, 'contributions' | 'unattributed'>

const NOTHING: Given = { contributions: [], unattributed: 0 }

/** A change smaller than this is the rounding of the same split */
const EPSILON = 1e-9

/** A damage of the window that the split after the battle takes again with the rates of the whole battle */
interface DamageRecord {
  eventTime: number
  attacker: number
  actor: number
  target: number
  origin: Origin
  amount: number
  effects: AttributionEffect[]
  outcome: AttributionOutcome
  /** Whose rates the split reads: the actor of a hit, the source of a tick of its own status */
  ratesOf: number
  /** The id of its DamageAttributionEvent and what that split gave; 0 and null before the realtime split */
  id: number
  realtime: Given | null
}

/** The realtime split of a share of a summed tick */
interface ShareSplit extends Given {
  attacker: number
  actor: number
  statusId: number
}

/**
 * Splits the damage of the players among them and the modifiers of others: the hits as they come, the shares of the
 * ticks as the estimator gives them, and the whole window again when it closes.
 */
export class DamageAttributor {
  /** The hits and the ticks of their own status in the window */
  private records: DamageRecord[] = []
  /** The summed ticks of the window, by tickId, as they came */
  private ticks = new Map<number, PeriodicTickEvent>()
  /** The realtime splits of the shares of the summed ticks of the window, by tickId */
  private shareSplits = new Map<number, ShareSplit[]>()
  /** The id of the last DamageAttributionEvent; a new zone goes on counting */
  private lastId = 0
  /** The player each combatant stood for when the window first met them: they may leave before the window closes */
  private players = new Map<number, number | null>()

  constructor(
    private estimator: PeriodicEstimator,
    private combatants: CombatWorld,
  ) {}

  /** Splits the damage hits of the effect; call it after the estimator read the input */
  handleEffect(event: Extract<CombatInput, { type: 'effect' }>): DamageAttributionEvent[] {
    const actor = actorId(event.caster)
    const attacker = this.playerOf(actor)
    if (attacker === null) return []
    const action = this.estimator.actionInfo(event.action)
    const output: DamageAttributionEvent[] = []
    for (const target of event.targets) {
      const combatant = actorId(target.id)
      if (!this.countsAsTarget(combatant)) continue
      const hits = target.hits.filter((entity) => entity.result !== 'heal' && !entity.onSource)
      if (hits.length === 0) continue
      const modifiers = this.estimator.modifiers.compute({
        kind: 'damage',
        caster: actor,
        target: combatant,
        action,
        ...(actor !== attacker && { owner: attacker }),
      })
      const effects = this.effectsOf(modifiers.effects, attacker)
      for (const entity of hits) {
        const record: DamageRecord = {
          eventTime: event.time,
          attacker,
          actor,
          target: combatant,
          origin: { type: 'action', action: event.action, sequence: event.sequence },
          amount: entity.amount,
          effects,
          outcome: {
            type: 'hit',
            critical: entity.critical,
            direct: entity.direct,
            forcedCritical: modifiers.forcedCritical,
            forcedDirect: modifiers.forcedDirect,
          },
          ratesOf: actor,
          id: 0,
          realtime: null,
        }
        this.records.push(record)
        output.push(this.splitRealtime(record, this.ratesNow(actor)))
      }
    }
    return output
  }

  /** Splits the damage shares of the tick */
  handleTick(event: PeriodicTickEvent): DamageAttributionEvent[] {
    if (event.isHeal || !this.countsAsTarget(event.combatant)) return []
    if (event.statusId === 0) this.ticks.set(event.tickId, event)
    const output: DamageAttributionEvent[] = []
    const splits: ShareSplit[] = []
    for (const share of event.shares) {
      const attacker = this.playerOf(share.sourceId)
      if (attacker === null || share.rates === null) continue
      const record = this.shareRecord(event, share, attacker)
      if (event.statusId !== 0) this.records.push(record)
      const split = this.splitRealtime(record, share.rates)
      output.push(split)
      const { contributions, unattributed } = split
      splits.push({ attacker, actor: share.sourceId, statusId: share.statusId, contributions, unattributed })
    }
    if (event.statusId === 0) this.shareSplits.set(event.tickId, splits)
    return output
  }

  /**
   * Splits the damage of the window again with the rates of the whole window, and starts a new window.
   * @param revision The PeriodicRevisionEvent of the window, null when the estimator gave none
   * @returns How each split changed from the realtime one; null when none changed
   */
  closeWindow(revision: PeriodicRevisionEvent | null, eventTime: number): AttributionDeltaEvent | null {
    const records: AttributionDelta[] = []
    for (const record of this.records) {
      const delta = deltaOf(record.realtime ?? NOTHING, this.resplit(record, this.ratesNow(record.ratesOf)))
      if (!delta) continue
      const origin: AttributionDelta['origin'] =
        record.origin.type === 'action'
          ? { type: 'action', action: record.origin.action }
          : { type: 'tick', statusId: record.origin.statusId }
      records.push({ id: record.id, tickId: null, attacker: record.attacker, actor: record.actor, origin, ...delta })
    }

    const revised = new Map(revision?.ticks.map((tick) => [tick.tickId, tick]))
    for (const [tickId, realtime] of this.ticks) {
      const tick = revised.get(tickId) ?? realtime
      // The revision may give the tick to other statuses and sources: a share missing on either side counts as nothing
      const before = new Map(this.shareSplits.get(tickId)?.map((split) => [shareKey(split), split]))
      const after = new Map<string, ShareSplit>()
      for (const share of tick.shares) {
        const attacker = this.playerOf(share.sourceId)
        if (attacker === null || share.rates === null) continue
        const { contributions, unattributed } = this.resplit(this.shareRecord(tick, share, attacker), share.rates)
        const split = { attacker, actor: share.sourceId, statusId: share.statusId, contributions, unattributed }
        after.set(shareKey(split), split)
      }
      for (const key of new Set([...before.keys(), ...after.keys()])) {
        const delta = deltaOf(before.get(key) ?? NOTHING, after.get(key) ?? NOTHING)
        if (!delta) continue
        const { attacker, actor, statusId } = (after.get(key) ?? before.get(key)) as ShareSplit
        records.push({ id: null, tickId, attacker, actor, origin: { type: 'tick', statusId }, ...delta })
      }
    }
    this.changeZone()
    return records.length === 0 ? null : { eventType: 'AttributionDeltaEvent', eventTime, records }
  }

  /** Forgets everything when the zone changes, after the window closed */
  changeZone(): void {
    this.records = []
    this.ticks = new Map()
    this.shareSplits = new Map()
    this.players = new Map()
  }

  private playerOf(id: number): number | null {
    let player = this.players.get(id)
    if (player === undefined) {
      player = playerOf(this.combatants, id)
      this.players.set(id, player)
    }
    return player
  }

  /** Damage on players and their pets does not count */
  private countsAsTarget(id: number): boolean {
    return id !== invalidTarget && this.playerOf(id) === null
  }

  private ratesNow(combatant: number) {
    const rates = this.estimator.ratesOf(combatant)
    return { ...rates, criticalMultiplier: criticalMultiplierOf(rates.critical) }
  }

  /** The modifiers, with their sources taken to the players they stand for */
  private effectsOf(modifiers: readonly SnapshotModifier[], attacker: number): AttributionEffect[] {
    return modifiers.map(({ statusId, sourceId, type, value }) => {
      const player = this.playerOf(sourceId)
      const owner = player === null ? 'other' : player === attacker ? 'self' : 'player'
      return { statusId, sourceId: player ?? sourceId, owner, type, value }
    })
  }

  private shareRecord(tick: PeriodicTickEvent, share: PeriodicShare, attacker: number): DamageRecord {
    return {
      eventTime: tick.eventTime,
      attacker,
      actor: share.sourceId,
      target: tick.combatant,
      origin: { type: 'tick', tickId: tick.tickId, statusId: share.statusId },
      amount: share.amount,
      effects: this.effectsOf(share.snapshot, attacker),
      outcome: { type: 'expected' },
      ratesOf: share.sourceId,
      id: 0,
      realtime: null,
    }
  }

  private resplit(record: DamageRecord, rates: Rates): AttributionResult {
    return attribute({ amount: record.amount, effects: record.effects, rates, outcome: record.outcome })
  }

  /** Splits the damage, and keeps the split on the record */
  private splitRealtime(record: DamageRecord, rates: Rates): DamageAttributionEvent {
    const result = this.resplit(record, rates)
    record.id = ++this.lastId
    record.realtime = { contributions: result.contributions, unattributed: result.unattributed }
    return {
      eventType: 'DamageAttributionEvent',
      eventTime: record.eventTime,
      id: record.id,
      attacker: record.attacker,
      actor: record.actor,
      target: record.target,
      origin: record.origin,
      amount: record.amount,
      retained: result.retained,
      contributions: result.contributions,
      unattributed: result.unattributed,
    }
  }
}

const shareKey = (split: Pick<ShareSplit, 'actor' | 'statusId'>) => `${split.actor}:${split.statusId}`

/** after minus before, with the parts sorted as in a split; null when nothing changed */
function deltaOf(before: Given, after: Given): Given | null {
  const parts = new Map<string, DamageContribution>()
  const add = (items: readonly DamageContribution[], sign: number) => {
    for (const { statusId, sourceId, amount } of items) {
      const key = `${sourceId}:${statusId}`
      const part = parts.get(key) ?? { statusId, sourceId, amount: 0 }
      part.amount += sign * amount
      parts.set(key, part)
    }
  }
  add(before.contributions, -1)
  add(after.contributions, 1)
  const contributions = [...parts.values()]
    .filter((part) => Math.abs(part.amount) >= EPSILON)
    .sort((a, b) => a.sourceId - b.sourceId || a.statusId - b.statusId)
  const unattributed = after.unattributed - before.unattributed
  if (contributions.length === 0 && Math.abs(unattributed) < EPSILON) return null
  return { contributions, unattributed: Math.abs(unattributed) < EPSILON ? 0 : unattributed }
}
