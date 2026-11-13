import { actorId, invalidTarget } from '../constants.js'
import {
  type Calibration,
  type PeriodicDefs,
  type PeriodicEffect,
  type PeriodicKind,
  potencyAt,
  potencyOrLast,
} from '../defs.js'
import type { PeriodicRevisionEvent, PeriodicShare, PeriodicTickEvent, PotencySampleEvent } from '../events.js'
import type { CombatInput, StatusChange } from '../input.js'
import type { TelemetrySample } from '../telemetry.js'
import type { CombatWorld } from '../world.js'
import { CalibrationSamples, samplePerPotency } from './calibration.js'
import { ElementTracker } from './elements.js'
import { allocate, type Block, GaussianState, type Member, roundShares } from './gaussian.js'
import { type ActionInfo, ModifierCalculator, type ModifierResult, type SnapshotEffect } from './modifiers.js'
import { reviseBattle } from './post.js'
import { computePrior, criticalMultiplierOf, type Prior } from './prior.js'
import { RateSamples } from './rates.js'
import { samplePotency } from './samples.js'
import { ratesOfStats } from './stat-rates.js'

/** How long an application waits for its status, and a status for its application */
export const APPLY_WINDOW = 3000
/** How long after a tick its status list may come */
export const CONFIRM_WINDOW = 100

type EffectInput = Extract<CombatInput, { type: 'effect' }>
type StatusListInput = Extract<CombatInput, { type: 'statusList' }>

/** A tick input with the engine's ids */
export interface TickInput {
  eventTime: number
  /** Who the tick hits */
  combatant: number
  isHeal: boolean
  statusId: number
  value: number
  sourceId: number
}

export interface SnapshotPrior extends Prior {
  /** ĉ and d̂ of the caster when the prior was computed */
  rates: { critical: number; direct: number }
}

/** What a status took when it was applied */
export interface Snapshot {
  id: number
  holder: number
  source: number
  status: number
  kind: PeriodicKind
  /** The slot of the status list */
  slot: number
  createdAt: number
  /** p, the potency of a tick at the level of the caster with the potency modifiers; null at an unknown level */
  potency: number | null
  /**
   * p̃, the potency the split weighs a snapshot without a prior by: the potency at the level of the caster, the last
   * one of the table at an unknown level, with the potency modifiers
   */
  splitPotency: number
  multiplier: number
  critDelta: number
  directDelta: number
  lowByte: number | null
  critByte: number | null
  effects: SnapshotEffect[]
  /** null until the caster has calibration samples */
  prior: SnapshotPrior | null
  /** Created by the status before its application came; the application fills the bytes */
  awaitingApply: boolean
}

/** A summed tick of a battle, as the realtime split left it */
export interface TickRecord {
  event: PeriodicTickEvent
  /** The members the tick was split among: the confirmed ones, or those the estimator knew */
  members: Snapshot[]
}

interface Application {
  time: number
  lowByte: number
  critByte: number
  potency: number | null
  splitPotency: number
  modifiers: ModifierResult
}

/** What a status that ticks on its own took when it was applied */
interface SeparateApplication {
  action: ActionInfo
  /** The modifiers of the caster */
  caster: SnapshotEffect[]
  /** The modifiers on each target of the effect that applied it */
  targets: Map<number, SnapshotEffect[]>
}

interface PendingTick {
  event: TickInput
  kind: PeriodicKind
  tickId: number
  prediction: number | null
  lifecycle: Snapshot[]
}

const keyOf = (holder: number, source: number, status: number) => `${holder}:${source}:${status}`
export const sourceKey = (snapshot: Pick<Snapshot, 'source' | 'kind'>) => `${snapshot.source}:${snapshot.kind}`
const signedByte = (byte: number) => (byte > 127 ? byte - 256 : byte)
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

/** The amounts and the bases of the shares of a summed tick */
export interface Split {
  amounts: number[]
  basis: PeriodicShare['basis'][]
  unknown: number
}

/** The total in proportion to the weights, those below 0 taken as 0; evenly when no weight is above 0 */
function proportional(weights: readonly number[], total: number): number[] {
  const kept = weights.map((weight) => Math.max(weight, 0))
  const weightSum = sum(kept)
  const values = kept.map((weight) => (weightSum > 0 ? (total * weight) / weightSum : total / kept.length))
  return roundShares(values, total)
}

/**
 * Splits a tick among its members. Only a tick without members is left unknown.
 * @param block The block of the members, when every member has a prior
 * @param noise r of each member, with the block
 * @param fallback The weight of each member when there is no block, from PeriodicEstimator.fallbackWeights
 * @param undo Takes the information of this tick out of the block before the conditional split
 */
export function splitTick(
  members: readonly Snapshot[],
  total: number,
  confirmed: boolean,
  block: Block | null,
  noise: readonly number[],
  fallback: readonly number[],
  undo: (block: Block) => Block = (value) => value,
): Split {
  if (members.length === 0) return { amounts: [], basis: [], unknown: total }

  if (confirmed && new Set(members.map((member) => member.source)).size === 1) {
    if (members.length === 1) return { amounts: [total], basis: ['exact'], unknown: 0 }
    const amounts = proportional(block ? block.mean : fallback, total)
    return { amounts, basis: members.map(() => 'sourceExact'), unknown: 0 }
  }

  const basis = confirmed ? 'estimated' : 'unconfirmed'
  const amounts = block
    ? roundShares(allocate(confirmed ? undo(block) : block, noise, total), total)
    : proportional(fallback, total)
  return { amounts, basis: members.map(() => basis), unknown: 0 }
}

/**
 * Splits the summed ticks of over time effects among the statuses and their sources as they come: it reads the
 * effects, the statuses and the ticks the parser hands it, and hands back a PeriodicTickEvent for every tick.
 */
export class PeriodicEstimator {
  readonly elements: ElementTracker
  readonly calibration = new CalibrationSamples()
  readonly rates = new RateSamples()
  /** The modifiers of the statuses at this moment, as the estimator computes them for its samples */
  readonly modifiers: ModifierCalculator
  private gaussian = new GaussianState()
  /** The live snapshot of each status */
  private snapshots = new Map<string, Snapshot>()
  private applications = new Map<string, Application>()
  /** The last application of each status that is not periodic, by source and status, for the ticks of its own */
  private separate = new Map<string, SeparateApplication>()
  /** Byte 1 of the entries of the statuses whose modifiers read it, waiting for their status */
  private byteRecords = new Map<string, { byte: number; time: number }>()
  /** The byte of each status that has it; null while the status waits for its entry */
  private statusBytes = new Map<
    string,
    { source: number; status: number; byte: number | null; waitingSince: number | null }
  >()
  private pending: PendingTick[] = []
  /** Snapshots that ended while a pending tick held them */
  private ended = new Set<Snapshot>()
  private battle: TickRecord[] = []
  private nextTickId = 1
  private nextSnapshotId = 1
  private samples: PotencySampleEvent[] = []
  telemetryEnabled = false
  private telemetry: TelemetrySample[] = []

  takeTelemetry(): TelemetrySample[] {
    const samples = this.telemetry
    this.telemetry = []
    return samples
  }
  /** Kept when the zone changes: the attributes may come just before the event of the change */
  private playerStats: { actorId: number; criticalHit: number; directHit: number } | null = null

  constructor(
    readonly defs: PeriodicDefs,
    private combatants: CombatWorld,
  ) {
    this.elements = new ElementTracker(defs.elements, combatants)
    this.modifiers = new ModifierCalculator(defs, combatants, this.elements, (holder, source, status) => {
      return this.statusBytes.get(keyOf(holder, source, status))?.byte ?? null
    })
  }

  /** The ticks of the current battle so far, for the split after it */
  get battleTicks(): readonly TickRecord[] {
    return this.battle
  }

  /** Takes the ticks of the battle that ended; the next ones belong to the next battle */
  takeBattle(): TickRecord[] {
    const ticks = this.battle
    this.battle = []
    return ticks
  }

  /**
   * Reads an input: effect, statuses, statusList, tick, gauge, playerStats, death and zone. statuses reads the world
   * after the slots changed. Every input first lets the pending ticks it is past expire.
   * @returns The ticks that are split now
   */
  handleEvent(input: CombatInput): PeriodicTickEvent[] {
    const output = this.expire(input.time)
    switch (input.type) {
      case 'effect':
        this.handleEffect(input)
        break
      case 'statuses':
        for (const change of input.changes) {
          output.push(...this.expire(input.time))
          if (change.kind === 'gained') this.handleGain(actorId(input.holder), change, input.time)
          else this.handleLose(actorId(input.holder), change)
        }
        break
      case 'statusList':
        output.push(...this.confirm(input))
        break
      case 'tick':
        output.push(
          ...this.handleTick({
            eventTime: input.time,
            combatant: actorId(input.target),
            isHeal: input.isHeal,
            statusId: input.status,
            value: input.amount,
            sourceId: actorId(input.source),
          }),
        )
        break
      case 'death':
        this.elements.death(actorId(input.actor))
        break
      case 'gauge':
        this.elements.handleGauge(input.actor, input.gauge)
        break
      case 'playerStats':
        this.setPlayerStats(input.actor, input.criticalHit, input.directHit)
        break
      case 'zone':
        output.push(...this.flush())
        this.clear()
        this.modifiers.zone = input.territory
        break
    }
    return output
  }

  /**
   * Ends the battle: splits the pending ticks, then splits every summed tick of the battle again.
   * @returns The pending ticks, then the PeriodicRevisionEvent when the battle had summed ticks
   */
  closeBattle(eventTime: number): (PeriodicTickEvent | PeriodicRevisionEvent)[] {
    const output: (PeriodicTickEvent | PeriodicRevisionEvent)[] = this.flush()
    const revision = reviseBattle(this, this.takeBattle(), eventTime)
    if (revision) output.push(revision)
    return output
  }

  /** Takes the potency samples of the effects handled since the last call */
  takeSamples(): PotencySampleEvent[] {
    const samples = this.samples
    this.samples = []
    return samples
  }

  /** Strict confirmation-window boundary; callers schedule in the same model time domain. */
  nextDeadline(): number | null {
    let due = Infinity
    for (const tick of this.pending) due = Math.min(due, tick.event.eventTime + CONFIRM_WINDOW + 1)
    return due === Infinity ? null : due
  }

  drainExpired(now: number): PeriodicTickEvent[] {
    if (!Number.isFinite(now)) throw new Error('Invalid estimator time')
    return this.expire(now)
  }

  /** Splits every pending tick as unconfirmed */
  flush(): PeriodicTickEvent[] {
    const output = this.pending.map((tick) => this.resolve(tick, tick.lifecycle, false))
    this.pending = []
    this.releaseEnded()
    return output
  }

  private clear(): void {
    this.elements.changeZone()
    this.calibration.clear()
    this.rates.clear()
    this.gaussian = new GaussianState()
    this.snapshots.clear()
    this.applications.clear()
    this.separate.clear()
    this.byteRecords.clear()
    this.statusBytes.clear()
    this.ended.clear()
    this.battle = []
    this.samples = []
  }

  private expire(now: number): PeriodicTickEvent[] {
    const output: PeriodicTickEvent[] = []
    this.pending = this.pending.filter((tick) => {
      if (now - tick.event.eventTime <= CONFIRM_WINDOW) return true
      output.push(this.resolve(tick, tick.lifecycle, false))
      return false
    })
    if (output.length) this.releaseEnded()
    return output
  }

  private level(combatant: number): number {
    return this.combatants.get(combatant).level ?? 0
  }

  /** The attributes of the player of the client, the only ones the game sends */
  setPlayerStats(actorId: number, criticalHit: number, directHit: number): void {
    this.playerStats = { actorId, criticalHit, directHit }
  }

  /** The natural rates of the combatant: from the attributes of the player when they apply, or else from the samples */
  ratesOf(combatant: number): { critical: number; direct: number } {
    if (this.playerStats?.actorId === combatant) {
      const modifier = this.defs.levelModifiers.get(this.level(combatant))
      const rates = modifier && ratesOfStats(this.playerStats, modifier)
      if (rates) return rates
    }
    return this.rates.rates(combatant)
  }

  /** The category and the attack type of the action; null for both when the data does not list it */
  actionInfo(id: number): ActionInfo {
    const type = this.defs.actionTypes.get(id)
    return type ? { id, ...type } : { id, category: null, attackType: null }
  }

  private handleEffect(event: EffectInput): void {
    const caster = actorId(event.caster)
    const action = event.action
    const info = this.actionInfo(action)
    const calibration = this.calibrationOf(action, caster)
    const job = this.combatants.get(caster).classJob
    const sampleAction = this.defs.samples.get(action)?.find((item) => item.job === job)
    const separate = new Set<number>()
    // A black mage of unknown elements gives no samples: Enochian and the elements change every one of them
    const sampled = !(this.elements.hasElements(caster) && this.elements.stateOf(caster) === null)

    for (const target of event.targets) {
      const combatant = actorId(target.id)
      if (combatant !== invalidTarget) {
        for (const entity of target.hits) {
          const damage = entity.result !== 'heal'
          const kind: PeriodicKind = damage ? 'damage' : 'heal'
          const modifiers = this.modifiers.compute({ kind, caster, target: combatant, action: info })
          const { critical, direct } = entity
          if (damage) {
            if (!modifiers.forcedCritical) this.rates.addCritical(caster, critical, modifiers.critRate)
            if (!modifiers.forcedDirect) this.rates.addDirect(caster, direct, modifiers.directRate)
          }

          if (
            sampleAction &&
            sampled &&
            entity.result === 'damage' &&
            target.index === 0 &&
            !modifiers.forcedCritical &&
            !modifiers.forcedDirect &&
            !modifiers.potencyBonus
          ) {
            const potency = samplePotency(sampleAction, this.level(caster), this.defs.maxLevel, entity.bonusPercent)
            if (potency !== null) {
              if (this.telemetryEnabled && !critical && !direct && modifiers.telemetryComplete && info.attackType) {
                const profile = this.combatants.get(caster)
                const corrected = entity.amount / (potency * modifiers.potencyFactor * modifiers.multiplier)
                if (
                  profile.classJob &&
                  profile.level &&
                  !profile.ownerId &&
                  potency > 0 &&
                  modifiers.potencyFactor > 0 &&
                  modifiers.multiplier > 0 &&
                  Number.isFinite(corrected) &&
                  corrected >= 0
                ) {
                  const unknown = new Map<string, { id: number; param: number }>()
                  for (const status of this.combatants.getBuffs(caster)) {
                    if (!this.defs.periodic.has(status.id) && !this.defs.modifiers.has(status.id))
                      unknown.set(`${status.id}:${status.stacks}`, { id: status.id, param: status.stacks })
                  }
                  this.telemetry.push({
                    casterId: caster,
                    targetId: combatant,
                    classJob: profile.classJob,
                    level: profile.level,
                    actionId: action,
                    damageType: info.attackType,
                    correctedDamagePerPotency: corrected,
                    unknownStatuses: [...unknown.values()].sort((a, b) => a.id - b.id || a.param - b.param),
                  })
                }
              }
              this.samples.push({
                eventType: 'PotencySampleEvent',
                eventTime: event.time,
                caster,
                target: combatant,
                action,
                sequence: event.sequence,
                amount: entity.amount,
                potency: potency * modifiers.potencyFactor,
                multiplier: modifiers.multiplier,
                factors: modifiers.effects
                  .filter((effect) => effect.type === 'multiplier')
                  .map(({ statusId, sourceId, holder, value }) => ({ statusId, sourceId, holder, value })),
                critical,
                direct,
              })
            }
          }

          const calibrates =
            calibration !== undefined &&
            sampled &&
            calibration.kind === kind &&
            (kind === 'heal' || entity.result === 'damage') &&
            !critical &&
            !direct &&
            !modifiers.forcedCritical &&
            !modifiers.forcedDirect &&
            target.index === 0
          if (!calibrates) continue
          const value = samplePerPotency(
            entity.amount,
            calibration.potency,
            this.level(caster),
            this.defs.maxLevel,
            modifiers.potencyFactor,
            modifiers.multiplier,
          )
          if (value === null) continue
          this.calibration.add(caster, kind, action, value)
          this.computePriors(caster, kind)
        }
      }

      for (const { status, onSource, byte1, byte2 } of target.applied) {
        const holder = onSource ? caster : combatant
        if (holder === invalidTarget) continue
        const key = keyOf(holder, caster, status)
        if (this.readsApplyByte(status)) this.recordByte(holder, caster, status, signedByte(byte1), event.time)
        const periodic = this.defs.periodic.get(status)
        if (periodic) this.recordApplication(key, periodic, caster, holder, byte1, byte2, event.time)
        else separate.add(status)
      }
    }
    if (separate.size) this.recordSeparate(event, info, separate)
    this.elements.applyAction(caster, action)
  }

  /**
   * Records what the statuses that are not periodic took: one of them may tick on its own, as the ground effects
   * and Flamethrower do, and these ticks take the modifiers of the application
   */
  private recordSeparate(event: EffectInput, action: ActionInfo, statuses: ReadonlySet<number>): void {
    const caster = actorId(event.caster)
    const query = { kind: 'damage' as const, caster, target: caster, action }
    const targets = new Map<number, SnapshotEffect[]>()
    for (const { id } of event.targets) {
      const combatant = actorId(id)
      if (combatant === invalidTarget || targets.has(combatant)) continue
      targets.set(combatant, this.modifiers.compute({ ...query, target: combatant }, 'target').effects)
    }
    const application = { action, caster: this.modifiers.compute(query, 'caster').effects, targets }
    for (const status of statuses) this.separate.set(`${caster}:${status}`, application)
  }

  /** The modifiers a damage tick of its own status takes: those of its application, none without one */
  private separateEffects(event: TickInput): SnapshotEffect[] {
    const application = this.separate.get(`${event.sourceId}:${event.statusId}`)
    if (!application) return []
    const onTarget =
      application.targets.get(event.combatant) ??
      this.modifiers.compute(
        { kind: 'damage', caster: event.sourceId, target: event.combatant, action: application.action },
        'target',
      ).effects
    return [...application.caster, ...onTarget].map((effect) => ({ ...effect }))
  }

  /**
   * The calibration of the action for the job of the caster; an action with one calibration has it for every job,
   * as a class that uses the actions of its job
   */
  private calibrationOf(action: number, caster: number): Calibration | undefined {
    const list = this.defs.calibration.get(action)
    if (!list) return undefined
    const job = this.combatants.get(caster).classJob ?? 0
    return list.find((item) => item.job === job) ?? (list.length === 1 ? list[0] : undefined)
  }

  private readsApplyByte(status: number): boolean {
    return (this.defs.modifiers.get(status) ?? []).some((modifier) => 'valueFrom' in modifier)
  }

  /** The status whose byte the status takes when it comes without an entry of its own; null for none */
  private byteOfStatus(status: number): number | null {
    for (const modifier of this.defs.modifiers.get(status) ?? []) {
      if ('byteOf' in modifier && modifier.byteOf !== null) return modifier.byteOf
    }
    return null
  }

  /** The byte of the status byteOf names that the source applied to itself; null when there is none in time */
  private borrowedByte(source: number, status: number, time: number): number | null {
    const byteOf = this.byteOfStatus(status)
    if (byteOf === null) return null
    const key = keyOf(source, source, byteOf)
    const current = this.statusBytes.get(key)?.byte
    if (current != null) return current
    const record = this.byteRecords.get(key)
    return record && time - record.time <= APPLY_WINDOW ? record.byte : null
  }

  private recordByte(holder: number, source: number, status: number, byte: number, time: number): void {
    const key = keyOf(holder, source, status)
    const current = this.statusBytes.get(key)
    if (current?.waitingSince != null && time - current.waitingSince <= APPLY_WINDOW) {
      this.statusBytes.set(key, { source, status, byte, waitingSince: null })
    } else {
      this.byteRecords.set(key, { byte, time })
    }
    if (holder !== source) return
    // The statuses that take this byte may have come before the entry, as the partner's Standard Finish
    for (const item of this.statusBytes.values()) {
      if (item.source !== source || item.waitingSince === null || time - item.waitingSince > APPLY_WINDOW) continue
      if (this.byteOfStatus(item.status) !== status) continue
      item.byte = byte
      item.waitingSince = null
    }
  }

  /** The potency and the modifiers a snapshot of the status takes now */
  private snapshotInputs(periodic: PeriodicEffect, caster: number, holder: number) {
    const modifiers = this.modifiers.compute({
      kind: periodic.kind,
      caster,
      target: holder,
      action: this.actionInfo(periodic.action),
    })
    const level = this.level(caster)
    const base = potencyAt(periodic.potency, level, this.defs.maxLevel)
    return {
      modifiers,
      potency: base === null ? null : base * modifiers.potencyFactor,
      splitPotency: potencyOrLast(periodic.potency, level, this.defs.maxLevel) * modifiers.potencyFactor,
    }
  }

  private recordApplication(
    key: string,
    periodic: PeriodicEffect,
    caster: number,
    holder: number,
    lowByte: number,
    critByte: number,
    time: number,
  ): void {
    const { modifiers, potency, splitPotency } = this.snapshotInputs(periodic, caster, holder)
    const snapshot = this.snapshots.get(key)
    if (snapshot?.awaitingApply && time - snapshot.createdAt <= APPLY_WINDOW) {
      // The status came first: its application fills in what the snapshot took
      snapshot.awaitingApply = false
      this.fill(snapshot, { time, lowByte, critByte, potency, splitPotency, modifiers })
      const prior = this.priorOf(snapshot)
      if (prior) {
        if (!snapshot.prior) this.gaussian.addSnapshot(snapshot.id, sourceKey(snapshot))
        snapshot.prior = prior
      }
      return
    }
    this.applications.set(key, { time, lowByte, critByte, potency, splitPotency, modifiers })
  }

  private fill(snapshot: Snapshot, application: Application): void {
    snapshot.lowByte = application.lowByte
    snapshot.critByte = application.critByte
    snapshot.potency = application.potency
    snapshot.splitPotency = application.splitPotency
    snapshot.multiplier = application.modifiers.multiplier
    snapshot.critDelta = application.modifiers.critRate
    snapshot.directDelta = application.modifiers.directRate
    snapshot.effects = application.modifiers.effects
  }

  private handleGain(holder: number, change: StatusChange, eventTime: number): void {
    const buff = { id: change.status, actorId: actorId(change.source) }
    const index = change.slot
    const key = keyOf(holder, buff.actorId, buff.id)

    if (this.readsApplyByte(buff.id)) {
      const record = this.byteRecords.get(key)
      const status = { source: buff.actorId, status: buff.id }
      const borrowed = this.borrowedByte(buff.actorId, buff.id, eventTime)
      if (record && eventTime - record.time <= APPLY_WINDOW) {
        this.byteRecords.delete(key)
        this.statusBytes.set(key, { ...status, byte: record.byte, waitingSince: null })
      } else if (borrowed !== null) {
        this.statusBytes.set(key, { ...status, byte: borrowed, waitingSince: null })
      } else {
        // A refresh without its entry keeps the byte it had, and waits for the entry
        const byte = this.statusBytes.get(key)?.byte ?? null
        this.statusBytes.set(key, { ...status, byte, waitingSince: eventTime })
      }
    }

    const periodic = this.defs.periodic.get(buff.id)
    if (!periodic) return
    const application = this.applications.get(key)
    const current = this.snapshots.get(key)
    if (application && eventTime - application.time <= APPLY_WINDOW) {
      this.applications.delete(key)
      if (current) this.end(current)
      this.create(key, periodic, holder, buff.actorId, buff.id, index, eventTime, application)
    } else if (!current) {
      const { modifiers, potency, splitPotency } = this.snapshotInputs(periodic, buff.actorId, holder)
      const snapshot = this.create(key, periodic, holder, buff.actorId, buff.id, index, eventTime, null)
      this.fill(snapshot, { time: eventTime, lowByte: 0, critByte: 0, potency, splitPotency, modifiers })
      snapshot.lowByte = null
      snapshot.critByte = null
      snapshot.awaitingApply = true
      snapshot.prior = this.priorOf(snapshot)
      if (snapshot.prior) this.gaussian.addSnapshot(snapshot.id, sourceKey(snapshot))
    } else {
      current.slot = index
    }
  }

  private create(
    key: string,
    periodic: PeriodicEffect,
    holder: number,
    source: number,
    status: number,
    slot: number,
    time: number,
    application: Application | null,
  ): Snapshot {
    const snapshot: Snapshot = {
      id: this.nextSnapshotId++,
      holder,
      source,
      status,
      kind: periodic.kind,
      slot,
      createdAt: time,
      potency: null,
      splitPotency: 0,
      multiplier: 1,
      critDelta: 0,
      directDelta: 0,
      lowByte: null,
      critByte: null,
      effects: [],
      prior: null,
      awaitingApply: false,
    }
    this.snapshots.set(key, snapshot)
    if (application) {
      this.fill(snapshot, application)
      snapshot.prior = this.priorOf(snapshot)
      if (snapshot.prior) this.gaussian.addSnapshot(snapshot.id, sourceKey(snapshot))
    }
    return snapshot
  }

  private handleLose(holder: number, change: StatusChange): void {
    const key = keyOf(holder, actorId(change.source), change.status)
    this.statusBytes.delete(key)
    const snapshot = this.snapshots.get(key)
    if (snapshot) this.end(snapshot)
  }

  private end(snapshot: Snapshot): void {
    const key = keyOf(snapshot.holder, snapshot.source, snapshot.status)
    if (this.snapshots.get(key) === snapshot) this.snapshots.delete(key)
    if (this.pending.some((tick) => tick.lifecycle.includes(snapshot))) this.ended.add(snapshot)
    else this.gaussian.removeSnapshot(snapshot.id)
  }

  /** Forgets the snapshots that ended once no pending tick holds them */
  private releaseEnded(): void {
    for (const snapshot of this.ended) {
      if (this.pending.some((tick) => tick.lifecycle.includes(snapshot))) continue
      this.ended.delete(snapshot)
      this.gaussian.removeSnapshot(snapshot.id)
    }
  }

  /** The prior of the snapshot with the samples of its caster so far; null without samples or potency */
  private priorOf(snapshot: Snapshot, all = false): SnapshotPrior | null {
    const perPotency = this.calibration.perPotency(snapshot.source, snapshot.kind, all)
    if (perPotency === null || snapshot.potency === null) return null
    const rates = this.ratesOf(snapshot.source)
    const prior = computePrior({
      kind: snapshot.kind,
      base: perPotency * snapshot.potency * snapshot.multiplier,
      lowByte: snapshot.lowByte,
      critByte: snapshot.critByte,
      critical: rates.critical,
      direct: rates.direct,
      critDelta: snapshot.critDelta,
      directDelta: snapshot.directDelta,
    })
    return { ...prior, rates }
  }

  /** Gives a prior to the live snapshots of the caster that wait for samples */
  private computePriors(caster: number, kind: PeriodicKind): void {
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.source !== caster || snapshot.kind !== kind || snapshot.prior) continue
      snapshot.prior = this.priorOf(snapshot)
      if (snapshot.prior) this.gaussian.addSnapshot(snapshot.id, sourceKey(snapshot))
    }
  }

  private handleTick(event: TickInput): PeriodicTickEvent[] {
    const tickId = this.nextTickId++
    if (event.statusId !== 0) {
      const rates = event.isHeal ? null : this.ratesOf(event.sourceId)
      return [
        {
          eventType: 'PeriodicTickEvent',
          eventTime: event.eventTime,
          tickId,
          phase: 'realtime',
          combatant: event.combatant,
          isHeal: event.isHeal,
          statusId: event.statusId,
          total: event.value,
          prediction: null,
          confirmed: true,
          unknown: 0,
          shares: [
            {
              statusId: event.statusId,
              sourceId: event.sourceId,
              amount: event.value,
              basis: 'exact',
              snapshot: event.isHeal ? [] : this.separateEffects(event),
              rates: rates && { ...rates, criticalMultiplier: criticalMultiplierOf(rates.critical) },
            },
          ],
        },
      ]
    }

    const kind: PeriodicKind = event.isHeal ? 'heal' : 'damage'
    const output: PeriodicTickEvent[] = []
    // The next tick of the same kind on the combatant ends the wait of the one before
    this.pending = this.pending.filter((tick) => {
      if (tick.event.combatant !== event.combatant || tick.kind !== kind) return true
      output.push(this.resolve(tick, tick.lifecycle, false))
      return false
    })
    if (output.length) this.releaseEnded()

    const lifecycle = [...this.snapshots.values()]
      .filter((snapshot) => snapshot.holder === event.combatant && snapshot.kind === kind)
      .sort((a, b) => a.slot - b.slot)
    const prediction =
      lifecycle.length > 0 && lifecycle.every((snapshot) => snapshot.prior)
        ? this.gaussian.predict(this.membersOf(lifecycle))
        : null
    this.pending.push({ event, kind, tickId, prediction, lifecycle })
    return output
  }

  private membersOf(snapshots: readonly Snapshot[]): Member[] {
    return snapshots.map((snapshot) => ({ id: snapshot.id, prior: (snapshot.prior as SnapshotPrior).mean }))
  }

  private confirm(event: StatusListInput): PeriodicTickEvent[] {
    const output: PeriodicTickEvent[] = []
    const holder = actorId(event.holder)
    this.pending = this.pending.filter((tick) => {
      if (tick.event.combatant !== holder) return true
      if (event.time < tick.event.eventTime) return true

      const members: Snapshot[] = []
      let named = true
      for (const status of event.statuses) {
        if (this.defs.periodic.get(status.id)?.kind !== tick.kind) continue
        const snapshot = this.snapshots.get(keyOf(holder, actorId(status.source), status.id))
        if (snapshot) members.push(snapshot)
        else named = false
      }
      const confirmed = named && members.length > 0
      output.push(this.resolve(tick, confirmed ? members : tick.lifecycle, confirmed))
      return false
    })
    this.releaseEnded()
    return output
  }

  /** Splits a tick among the members, and updates the state with it when it was confirmed */
  private resolve(tick: PendingTick, members: Snapshot[], confirmed: boolean): PeriodicTickEvent {
    const { event } = tick
    const withPriors = members.length > 0 && members.every((member) => member.prior)
    const gaussianMembers = withPriors ? this.membersOf(members) : []
    const block = withPriors ? this.gaussian.block(gaussianMembers) : null
    const noise = withPriors ? members.map((member) => (member.prior as SnapshotPrior).variance) : []
    const fallback = block ? [] : this.fallbackWeights(members, (snapshot) => snapshot.prior, false)
    const split = splitTick(members, event.value, confirmed, block, noise, fallback)
    if (confirmed && withPriors) this.gaussian.update(gaussianMembers, event.value, sum(noise))

    const result: PeriodicTickEvent = {
      eventType: 'PeriodicTickEvent',
      eventTime: event.eventTime,
      tickId: tick.tickId,
      phase: 'realtime',
      combatant: event.combatant,
      isHeal: event.isHeal,
      statusId: 0,
      total: event.value,
      prediction: tick.prediction,
      confirmed,
      unknown: split.unknown,
      shares: this.shares(members, split, (snapshot) => snapshot.prior),
    }
    this.battle.push({ event: result, members })
    return result
  }

  /** The shares of a split, with the modifiers the snapshots took */
  shares(
    members: readonly Snapshot[],
    split: Split,
    priorOf: (snapshot: Snapshot) => SnapshotPrior | null,
  ): PeriodicShare[] {
    return split.amounts.map((amount, index) => {
      const snapshot = members[index]
      const prior = priorOf(snapshot)
      const rates = prior?.rates ?? this.ratesOf(snapshot.source)
      const criticalMultiplier = prior?.criticalMultiplier ?? criticalMultiplierOf(rates.critical)
      return {
        statusId: snapshot.status,
        sourceId: snapshot.source,
        amount,
        basis: split.basis[index],
        snapshot: snapshot.effects.map((effect) => ({ ...effect })),
        rates: { ...rates, criticalMultiplier },
      }
    })
  }

  /**
   * The weights of a split without the block. A member with a prior weighs its mean μ; one without weighs the mean of
   * a prior on ρ̃ × p̃ × M, where ρ̃ is ρ of its caster or else the median ρ of the casters of the kind, so that both
   * take the expected gain of critical and direct hits. Without any ρ of the kind no member has a prior, and each
   * weighs p̃ × M.
   * @param all Read every sample since the zone changed, as the split after a battle does
   */
  fallbackWeights(
    members: readonly Snapshot[],
    priorOf: (snapshot: Snapshot) => SnapshotPrior | null,
    all: boolean,
  ): number[] {
    return members.map((snapshot) => {
      const prior = priorOf(snapshot)
      if (prior) return prior.mean
      const rho =
        this.calibration.perPotency(snapshot.source, snapshot.kind, all) ??
        this.calibration.medianPerPotency(snapshot.kind, all)
      if (rho === null) return snapshot.splitPotency * snapshot.multiplier
      const { critical, direct } = this.ratesOf(snapshot.source)
      return computePrior({
        kind: snapshot.kind,
        base: rho * snapshot.splitPotency * snapshot.multiplier,
        lowByte: snapshot.lowByte,
        critByte: snapshot.critByte,
        critical,
        direct,
        critDelta: snapshot.critDelta,
        directDelta: snapshot.directDelta,
      }).mean
    })
  }

  /** The prior of the snapshot with every sample of its caster since the zone changed, for the split after a battle */
  priorWithAllSamples(snapshot: Snapshot): SnapshotPrior | null {
    return this.priorOf(snapshot, true)
  }
}
