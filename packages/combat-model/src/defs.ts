export type PeriodicKind = 'damage' | 'heal'
export type ActionCategory = 'spell' | 'weaponskill' | 'ability'
/** physical: the attack type of the weapon, AttackType -1, which the physical actions of 7.0 and later have */
export type AttackType = 'slashing' | 'piercing' | 'blunt' | 'shot' | 'physical' | 'magic' | 'darkness'
export type DamageType = 'physical' | 'magic' | 'darkness'

/** Ascending levels from 1; the potency of a level is that of the last entry at or below it */
export type PotencyTable = readonly { level: number; potency: number }[]

/** Ascending levels from 1, as a potency table */
export type ValueTable = readonly { level: number; value: number }[]

/** The entry of a table for a level, the last one at or below it */
function entryAt<T extends { level: number }>(table: readonly T[], level: number): T | undefined {
  let found: T | undefined
  for (const entry of table) {
    if (entry.level > level) break
    found = entry
  }
  return found
}

/** @returns The potency at the level; null when the level is 0 (unknown) or above maxLevel */
export function potencyAt(table: PotencyTable, level: number, maxLevel: number): number | null {
  if (level < 1 || level > maxLevel) return null
  return entryAt(table, level)?.potency ?? null
}

/** @returns The value at the level; the last value when the level is unknown (0) */
export function valueAt(table: ValueTable, level: number): number {
  if (level < 1) return table[table.length - 1].value
  return (entryAt(table, level) ?? table[0]).value
}

/** null where the file leaves the condition out */
interface ModifierConditions {
  zones: readonly number[] | null
  actions: readonly number[] | null
}

/**
 * A value by the level of the source of the status, or the signed percentage in byte 1 of the effect entry that
 * applied the status. byteOf names the status whose entry the source applied to itself, for a status that comes
 * without an entry of its own, as Standard Finish on the dance partner.
 */
type ModifierValue = { value: ValueTable } | { valueFrom: 'applyByte'; byteOf: number | null }

export type StatusModifier =
  | ({ type: 'damageDealt' | 'healingDealt'; stacked: boolean; category: ActionCategory | null } & ModifierValue &
      ModifierConditions & { damageType: DamageType | null })
  | ({
      type: 'damageTaken' | 'healingReceived'
      scope: 'all' | 'source'
      stacked: boolean
      category: ActionCategory | null
    } & ModifierValue &
      ModifierConditions & { damageType: DamageType | null })
  | ({ type: 'critRate' | 'directHitRate'; value: ValueTable; stacked: boolean } & ModifierConditions)
  | ({ type: 'critRateTaken'; value: ValueTable; scope: 'all' | 'source'; stacked: boolean } & ModifierConditions)
  | ({ type: 'forceCritical' | 'forceDirect' } & ModifierConditions)
  /**
   * The status adds potency to the actions of its holder by a fixed amount or to some of them only, which no factor
   * gives; the hits it touches are no potency samples
   */
  | ({ type: 'potencyBonus'; category: ActionCategory | null } & ModifierConditions)

export type ForcedResult = 'critical' | 'direct' | 'criticalDirect'

export interface PeriodicEffect {
  kind: PeriodicKind
  action: number
  job: number
  potency: PotencyTable
}

export interface Calibration {
  kind: PeriodicKind
  job: number
  potency: PotencyTable
  gauge: boolean
}

/** The potencies besides the base one that a description states: in a combo, from the rear or the flank, or both */
export type SampleVariant = 'combo' | 'rear' | 'flank' | 'comboRear' | 'comboFlank'

/** The potencies of an action of a job, from which a hit gives a potency sample */
export interface SampleAction {
  job: number
  potency: { base: PotencyTable } & Partial<Record<SampleVariant, PotencyTable>>
}

/** What the conditions of the modifiers read of an action */
export interface ActionType {
  category: ActionCategory
  /** null for an action without an attack type, AttackType 0, as most heals */
  attackType: AttackType | null
}

/** The gauges whose state the estimator infers from the actions of any caster */
export type InferredGaugeName = 'BlackMage'

/** What a condition reads: the fields the inference gives, from the gauge input for the recording player */
export type GaugeCondition<N extends InferredGaugeName> = {
  /** elementStance: the stacks of Astral Fire, negative for those of Umbral Ice */
  BlackMage: { job: 'BlackMage'; elementStance: number; enochianActive: boolean }
}[N]

export type GaugeModifier = {
  [N in InferredGaugeName]: {
    /** The gauge the condition reads */
    gauge: N
    /** Whether the modifier applies with this state of the gauge */
    when: (gauge: GaugeCondition<N>) => boolean
    type: 'damageDealt' | 'potency'
    /** Ascending levels from 1, as a potency table */
    value: ValueTable
    actions: readonly number[] | null
    category: ActionCategory | null
    damageType: DamageType | null
  }
}[InferredGaugeName]

/**
 * fire and ice add a stack, or only remove the other element; fireSwitch and iceSwitch add a stack, or remove the
 * other element and give one stack
 */
export type ElementChange =
  | { kind: 'set'; element: 'astralFire' | 'umbralIce'; stacks: 1 | 2 | 3 | 'max' }
  | { kind: 'fire' | 'ice' | 'fireSwitch' | 'iceSwitch' | 'umbralSoul' | 'transpose' }

/** Ascending levels from 1, as a potency table: the change at each level */
export type ElementChangeTable = readonly { level: number; change: ElementChange }[]

export interface ElementRules {
  /** The classes and jobs that keep the elements */
  classJobs: readonly number[]
  enochianLevel: number
  /** Ascending levels from 1, as a potency table */
  maxStacks: ValueTable
  actions: readonly { id: number; change: ElementChangeTable }[]
}

/** The level modifiers that turn the critical and direct hit attributes into rates */
export interface LevelModifier {
  sub: number
  div: number
}

export interface PeriodicDefs {
  version: string
  gameVersion: string
  maxLevel: number
  /** Status ID → the periodic effect */
  periodic: ReadonlyMap<number, PeriodicEffect>
  /** Status ID → its modifiers */
  modifiers: ReadonlyMap<number, readonly StatusModifier[]>
  /** Action ID → its calibrations, one for each job that has its own potency */
  calibration: ReadonlyMap<number, readonly Calibration[]>
  /** Action ID → the potencies of each job that uses it, for the potency samples */
  samples: ReadonlyMap<number, readonly SampleAction[]>
  /** Action ID → the category and the attack type of the actions of the classes and jobs, without those of their pets */
  actionTypes: ReadonlyMap<number, ActionType>
  /**
   * The statuses of the raid buffs: those a raid buff gives the party or the target, that raise the damage of the
   * party, as Divination or the vulnerability of Mug. Not those only the caster has, as Embolden on the red mage. A
   * status the caster has as well, as Devilment, is a raid buff on the others: its source tells them apart.
   */
  raidBuffStatuses: ReadonlySet<number>
  /** Action ID → how long its effect lasts in seconds, for the actions that are raid buffs */
  raidBuffActions: ReadonlyMap<number, number>
  /** Action ID → how long its effect lasts in seconds, for the actions that lower the damage the party takes */
  partyMitigations: ReadonlyMap<number, number>
  /** Level → its modifiers */
  levelModifiers: ReadonlyMap<number, LevelModifier>
  /** Effects that depend on the state of a gauge */
  gauge: readonly GaugeModifier[]
  /** How the actions of a black mage change the elements */
  elements: ElementRules
  /** Action ID → forced result */
  forced: ReadonlyMap<number, ForcedResult>
}

export class PeriodicDefsError extends Error {
  readonly name = 'PeriodicDefsError'

  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`)
  }
}

export const ACTION_CATEGORIES: readonly ActionCategory[] = ['spell', 'weaponskill', 'ability']
export const ATTACK_TYPES: readonly AttackType[] = [
  'slashing',
  'piercing',
  'blunt',
  'shot',
  'physical',
  'magic',
  'darkness',
]
const DAMAGE_TYPES: readonly DamageType[] = ['physical', 'magic', 'darkness']
const KINDS: readonly PeriodicKind[] = ['damage', 'heal']
const FORCED: readonly ForcedResult[] = ['critical', 'direct', 'criticalDirect']
const MULTIPLIERS = ['damageDealt', 'healingDealt', 'damageTaken', 'healingReceived'] as const
const RATES = ['critRate', 'directHitRate', 'critRateTaken'] as const
const FORCES = ['forceCritical', 'forceDirect'] as const
const BONUSES = ['potencyBonus'] as const
/** The modifiers on the target, which say whose actions they take */
const TAKEN = ['damageTaken', 'healingReceived', 'critRateTaken']
const INFERRED_GAUGES: readonly InferredGaugeName[] = ['BlackMage']
export const SAMPLE_VARIANTS: readonly SampleVariant[] = ['combo', 'rear', 'flank', 'comboRear', 'comboFlank']
const ELEMENT_KINDS = ['set', 'fire', 'ice', 'fireSwitch', 'iceSwitch', 'umbralSoul', 'transpose'] as const

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'object') return 'an object'
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The entries mergeClassJobActions builds for parsePeriodicDefs, with the path of the entry of the file each comes
 * from, so that an error names the file and not the merged input
 */
const origins = new WeakMap<object, string>()

/** Reads one value of the input, and knows where it is */
class Reader {
  constructor(
    readonly value: unknown,
    readonly path: string,
  ) {}

  fail(reason: string): never {
    throw new PeriodicDefsError(this.path, reason)
  }

  /** The member at the key; its path follows that of this object, or is that of the file entry it was merged from */
  at(key: string | number): Reader {
    const value =
      typeof key === 'number' ? (this.value as unknown[])[key] : (this.value as Record<string, unknown>)[key]
    const origin = typeof value === 'object' && value !== null ? origins.get(value) : undefined
    if (origin !== undefined) return new Reader(value, origin)
    const path = typeof key === 'number' ? `${this.path}[${key}]` : this.path ? `${this.path}.${key}` : key
    return new Reader(value, path)
  }

  /** Checks that this is an object with only the keys given; returns the keys it has */
  object(required: readonly string[], optional: readonly string[] = []): Set<string> {
    if (!isObject(this.value)) this.fail(`expected an object, got ${describe(this.value)}`)
    const keys = new Set(Object.keys(this.value))
    for (const key of required) if (!keys.has(key)) this.at(key).fail('is required')
    for (const key of keys) {
      if (!required.includes(key) && !optional.includes(key)) this.at(key).fail('is not a known field')
    }
    return keys
  }

  array(nonEmpty = false): Reader[] {
    if (!Array.isArray(this.value)) this.fail(`expected an array, got ${describe(this.value)}`)
    if (nonEmpty && this.value.length === 0) this.fail('must not be empty')
    return this.value.map((_, index) => this.at(index))
  }

  string(): string {
    if (typeof this.value !== 'string' || this.value === '') {
      this.fail(`expected a non-empty string, got ${describe(this.value)}`)
    }
    return this.value
  }

  number(): number {
    if (typeof this.value !== 'number' || !Number.isFinite(this.value)) {
      this.fail(`expected a number, got ${describe(this.value)}`)
    }
    return this.value
  }

  positiveInteger(): number {
    if (typeof this.value !== 'number' || !Number.isSafeInteger(this.value) || this.value < 1) {
      this.fail(`expected a positive integer, got ${describe(this.value)}`)
    }
    return this.value
  }

  oneOf<T extends string>(choices: readonly T[]): T {
    if (!choices.includes(this.value as T)) {
      this.fail(`expected one of ${choices.join(', ')}, got ${describe(this.value)}`)
    }
    return this.value as T
  }

  isTrue(): true {
    if (this.value !== true) this.fail(`expected true, got ${describe(this.value)}`)
    return true
  }

  /** A non-empty array of distinct positive integers */
  ids(): number[] {
    const ids = this.array(true).map((item) => item.positiveInteger())
    if (new Set(ids).size !== ids.length) this.fail('has an ID more than once')
    return ids
  }
}

/**
 * Checks the levels of a table: from level 1, strictly ascending, at most maxLevel, and adjacent values different.
 * @param readValue Reads the value of an entry
 * @param same Whether two values are the same
 */
function readLevelTable<T extends string, V>(
  input: Reader,
  valueKey: T,
  maxLevel: number,
  readValue: (value: Reader) => V,
  same: (a: V, b: V) => boolean = (a, b) => a === b,
): ({ level: number } & Record<T, V>)[] {
  const entries = input.array(true).map((entry) => {
    entry.object(['level', valueKey])
    const level = entry.at('level').positiveInteger()
    if (level > maxLevel) entry.at('level').fail(`${level} is above the maximum level ${maxLevel}`)
    return { level, [valueKey]: readValue(entry.at(valueKey)) } as { level: number } & Record<T, V>
  })
  entries.forEach((entry, index) => {
    const path = input.at(index)
    if (index === 0) {
      if (entry.level !== 1) path.at('level').fail('the first entry must be level 1')
      return
    }
    const before = entries[index - 1]
    if (entry.level <= before.level) path.at('level').fail('levels must ascend')
    if (same(entry[valueKey], before[valueKey])) path.at(valueKey).fail('must differ from the entry before')
  })
  return entries
}

const readPotencyTable = (input: Reader, maxLevel: number): PotencyTable =>
  readLevelTable(input, 'potency', maxLevel, (value) => value.positiveInteger())

/**
 * A table of modifier values greater than -1. A value may be 0 at the levels before a trait adds the effect, but not at
 * every level.
 */
function readValueTable(input: Reader, maxLevel: number): ValueTable {
  if (!Array.isArray(input.value)) input.fail(`expected a table of { level, value }, got ${describe(input.value)}`)
  const table = readLevelTable(input, 'value', maxLevel, (value) => {
    const number = value.number()
    if (number <= -1) value.fail(`must be greater than -1, got ${number}`)
    return number
  })
  if (table.every((entry) => entry.value === 0)) input.fail('must not be 0 at every level')
  return table
}

/** null for an action without an attack type, AttackType 0, as most heals */
const readAttackType = (input: Reader): AttackType | null => (input.value === null ? null : input.oneOf(ATTACK_TYPES))

function readVersion(input: Reader) {
  input.object(['version', 'gameVersion', 'maxLevel'])
  return {
    version: input.at('version').string(),
    gameVersion: input.at('gameVersion').string(),
    maxLevel: input.at('maxLevel').positiveInteger(),
  }
}

/** The conditions all modifiers may have */
function readConditions(input: Reader, keys: Set<string>): ModifierConditions {
  return {
    zones: keys.has('zones') ? input.at('zones').ids() : null,
    actions: keys.has('actions') ? input.at('actions').ids() : null,
  }
}

function readModifier(input: Reader, maxLevel: number): StatusModifier {
  input.object(
    ['type'],
    ['value', 'valueAction', 'valueFrom', 'byteOf', 'stacked', 'scope', 'zones', 'actions', 'category', 'damageType'],
  )
  const type = input.at('type').oneOf([...MULTIPLIERS, ...RATES, ...FORCES, ...BONUSES])
  const isMultiplier = (MULTIPLIERS as readonly string[]).includes(type)
  const isRate = (RATES as readonly string[]).includes(type)
  const isTaken = TAKEN.includes(type)
  const isDamage = type === 'damageDealt' || type === 'damageTaken'
  const isBonus = type === 'potencyBonus'

  const allowed = ['type', 'zones', 'actions']
  if (isMultiplier || isRate) allowed.push('value', 'valueAction', 'stacked')
  if (isMultiplier || isBonus) allowed.push('category')
  if (isMultiplier) allowed.push('valueFrom', 'byteOf')
  if (isDamage) allowed.push('damageType')
  if (isTaken) allowed.push('scope')
  const keys = input.object(isTaken ? ['type', 'scope'] : ['type'], allowed)

  const conditions = readConditions(input, keys)
  if (isBonus) {
    const category = keys.has('category') ? input.at('category').oneOf(ACTION_CATEGORIES) : null
    return { type, category, ...conditions }
  }
  if (!isMultiplier && !isRate) return { type, ...conditions } as StatusModifier

  if (keys.has('value') && keys.has('valueFrom')) input.at('valueFrom').fail('cannot be given with value')
  if (!keys.has('value') && !keys.has('valueFrom')) {
    input.at('value').fail(isMultiplier ? 'value or valueFrom is required' : 'is required')
  }
  if (keys.has('valueFrom') && keys.has('valueAction')) input.at('valueAction').fail('is only for a value')
  if (keys.has('valueAction')) input.at('valueAction').positiveInteger()
  if (keys.has('byteOf') && !keys.has('valueFrom')) input.at('byteOf').fail('is only for valueFrom')
  const value: ModifierValue = keys.has('valueFrom')
    ? {
        valueFrom: input.at('valueFrom').oneOf(['applyByte'] as const),
        byteOf: keys.has('byteOf') ? input.at('byteOf').positiveInteger() : null,
      }
    : { value: readValueTable(input.at('value'), maxLevel) }

  const stacked = keys.has('stacked') ? input.at('stacked').isTrue() : false
  const scope = isTaken ? { scope: input.at('scope').oneOf(['all', 'source'] as const) } : {}
  if (isRate) return { type, ...value, stacked, ...scope, ...conditions } as StatusModifier
  return {
    type,
    ...value,
    stacked,
    ...scope,
    category: keys.has('category') ? input.at('category').oneOf(ACTION_CATEGORIES) : null,
    damageType: keys.has('damageType') ? input.at('damageType').oneOf(DAMAGE_TYPES) : null,
    ...conditions,
  } as StatusModifier
}

function readStatuses(input: Reader, maxLevel: number, requirePotency: boolean) {
  input.object(['statuses'])
  const periodic = new Map<number, PeriodicEffect>()
  const modifiers = new Map<number, readonly StatusModifier[]>()
  const jobs: { path: Reader; kind: PeriodicKind; job: number }[] = []
  const actionRefs: ActionRef[] = []
  const seen = new Set<number>()
  /** The statuses byteOf names, which must read the byte themselves */
  const byteRefs: { path: Reader; id: number }[] = []

  for (const entry of input.at('statuses').array()) {
    const keys = entry.object(['id'], ['periodic', 'modifiers'])
    const id = entry.at('id').positiveInteger()
    if (seen.has(id)) entry.at('id').fail(`status ${id} is listed more than once`)
    seen.add(id)
    if (!keys.has('periodic') && !keys.has('modifiers')) entry.fail('needs periodic or modifiers')

    if (keys.has('periodic')) {
      const item = entry.at('periodic')
      const itemKeys = item.object(
        ['kind', 'action', 'job', ...(requirePotency ? ['potency'] : [])],
        requirePotency ? [] : ['potency'],
      )
      const effect: PeriodicEffect = {
        kind: item.at('kind').oneOf(KINDS),
        action: item.at('action').positiveInteger(),
        job: item.at('job').positiveInteger(),
        potency: itemKeys.has('potency') ? readPotencyTable(item.at('potency'), maxLevel) : [],
      }
      periodic.set(id, effect)
      jobs.push({ path: item.at('job'), kind: effect.kind, job: effect.job })
      actionRefs.push({ path: item.at('action'), id: effect.action })
    }
    if (keys.has('modifiers')) {
      const items = entry.at('modifiers').array(true)
      const read = items.map((item) => readModifier(item, maxLevel))
      read.forEach((modifier, index) => {
        if ('byteOf' in modifier && modifier.byteOf !== null) {
          byteRefs.push({ path: items[index].at('byteOf'), id: modifier.byteOf })
        }
      })
      modifiers.set(id, read)
    }
  }
  for (const { path, id } of byteRefs) {
    if (!(modifiers.get(id) ?? []).some((modifier) => 'valueFrom' in modifier)) {
      path.fail(`status ${id} has no modifier with valueFrom`)
    }
  }
  return { periodic, modifiers, jobs, actionRefs }
}

function readActions(input: Reader, maxLevel: number, requirePotency: boolean) {
  input.object(['actions'])
  const calibration = new Map<number, Calibration[]>()
  const forced = new Map<number, ForcedResult>()
  /** An action may have a calibration for each job; forced once */
  const seen = new Set<string>()
  const actionRefs: ActionRef[] = []

  for (const entry of input.at('actions').array()) {
    const keys = entry.object(['id'], ['job', 'calibration', 'forced'])
    const id = entry.at('id').positiveInteger()
    const job = keys.has('job') ? entry.at('job').positiveInteger() : null
    if (seen.has(`${id}:${job}`)) {
      entry.at('id').fail(`action ${id} is listed more than once${job === null ? '' : ` for job ${job}`}`)
    }
    seen.add(`${id}:${job}`)
    if (!keys.has('calibration') && !keys.has('forced')) entry.fail('needs calibration or forced')

    if (keys.has('forced')) {
      if (forced.has(id)) entry.at('forced').fail(`action ${id} is forced more than once`)
      forced.set(id, entry.at('forced').oneOf(FORCED))
    }
    if (!keys.has('calibration')) {
      if (keys.has('job')) entry.at('job').fail('is only for a calibration action')
      continue
    }
    if (job === null) entry.at('job').fail('is required for a calibration action')
    actionRefs.push({ path: entry.at('id'), id })

    const item = entry.at('calibration')
    const itemKeys = item.object(
      ['kind', ...(requirePotency ? ['potency'] : [])],
      requirePotency ? ['gauge'] : ['gauge', 'potency'],
    )
    const list = calibration.get(id) ?? []
    calibration.set(id, list)
    list.push({
      kind: item.at('kind').oneOf(KINDS),
      job: job as number,
      potency: itemKeys.has('potency') ? readPotencyTable(item.at('potency'), maxLevel) : [],
      gauge: itemKeys.has('gauge') ? item.at('gauge').isTrue() : false,
    })
  }
  return { calibration, forced, actionRefs }
}

function readSampleActions(input: Reader, maxLevel: number) {
  input.object(['actions'])
  const samples = new Map<number, SampleAction[]>()
  const actionRefs: ActionRef[] = []
  for (const entry of input.at('actions').array()) {
    entry.object(['id', 'job', 'potency'])
    const id = entry.at('id').positiveInteger()
    const job = entry.at('job').positiveInteger()
    const list = samples.get(id) ?? []
    if (list.some((item) => item.job === job)) {
      entry.at('id').fail(`action ${id} is listed more than once for job ${job}`)
    }
    const tables = entry.at('potency')
    const keys = tables.object(['base'], SAMPLE_VARIANTS)
    const potency = Object.fromEntries(
      [...keys].map((key) => [key, readPotencyTable(tables.at(key), maxLevel)]),
    ) as SampleAction['potency']
    list.push({ job, potency })
    samples.set(id, list)
    actionRefs.push({ path: entry.at('id'), id })
  }
  return { samples, actionRefs }
}

/** @param requireAll Whether every level from 1 to maxLevel must be there */
function readLevelModifiers(input: Reader, maxLevel: number, requireAll: boolean): Map<number, LevelModifier> {
  input.object(['levels'])
  const modifiers = new Map<number, LevelModifier>()
  const levels = input.at('levels')
  for (const entry of levels.array()) {
    entry.object(['level', 'sub', 'div'])
    const level = entry.at('level').positiveInteger()
    if (level > maxLevel) entry.at('level').fail(`${level} is above the maximum level ${maxLevel}`)
    if (modifiers.has(level)) entry.at('level').fail(`level ${level} is listed more than once`)
    modifiers.set(level, { sub: entry.at('sub').positiveInteger(), div: entry.at('div').positiveInteger() })
  }
  if (requireAll) {
    for (let level = 1; level <= maxLevel; level++) {
      if (!modifiers.has(level)) levels.fail(`level ${level} is missing`)
    }
  }
  return modifiers
}

/** An action a file names, which the action types must list */
interface ActionRef {
  path: Reader
  id: number
}

function readActionTypes(input: Reader, requirePotency: boolean): Map<number, ActionType> {
  input.object(['actions'])
  const types = new Map<number, ActionType>()
  let last = 0
  for (const entry of input.at('actions').array(requirePotency)) {
    entry.object(['id', 'category', 'attackType'])
    const id = entry.at('id').positiveInteger()
    if (id <= last) entry.at('id').fail('IDs must ascend')
    last = id
    types.set(id, {
      category: entry.at('category').oneOf(ACTION_CATEGORIES),
      attackType: readAttackType(entry.at('attackType')),
    })
  }
  return types
}

function readGauge(input: Reader, maxLevel: number): GaugeModifier[] {
  return input.array().map((entry) => {
    entry.object(['gauge', 'when', 'type', 'value', 'actions', 'category', 'damageType'])
    const gauge = entry.at('gauge').oneOf(INFERRED_GAUGES)
    if (typeof entry.at('when').value !== 'function') entry.at('when').fail('expected a function')
    const type = entry.at('type').oneOf(['damageDealt', 'potency'] as const)
    const actions = entry.at('actions').value === null ? null : entry.at('actions').ids()
    if (type === 'potency' && actions === null) entry.at('actions').fail('a potency modifier needs its actions')
    const category = entry.at('category')
    const damageType = entry.at('damageType')
    return {
      gauge,
      when: entry.at('when').value as GaugeModifier['when'],
      type,
      value: readValueTable(entry.at('value'), maxLevel),
      actions,
      category: category.value === null ? null : category.oneOf(ACTION_CATEGORIES),
      damageType: damageType.value === null ? null : damageType.oneOf(DAMAGE_TYPES),
    }
  })
}

function readElementChange(change: Reader): ElementChange {
  const kind = change.at('kind').oneOf(ELEMENT_KINDS)
  if (kind !== 'set') {
    change.object(['kind'])
    return { kind }
  }
  change.object(['kind', 'element', 'stacks'])
  const element = change.at('element').oneOf(['astralFire', 'umbralIce'] as const)
  const stacks = change.at('stacks')
  if (stacks.value !== 'max' && stacks.value !== 1 && stacks.value !== 2 && stacks.value !== 3) {
    stacks.fail(`expected 1 to 3 or "max", got ${describe(stacks.value)}`)
  }
  return { kind, element, stacks: stacks.value as 1 | 2 | 3 | 'max' }
}

const sameChange = (a: ElementChange, b: ElementChange) =>
  a.kind === b.kind && (a.kind !== 'set' || (b.kind === 'set' && a.element === b.element && a.stacks === b.stacks))

function readElements(input: Reader, maxLevel: number): ElementRules {
  input.object(['classJobs', 'enochianLevel', 'maxStacks', 'actions'])
  const classJobs = input.at('classJobs').ids()
  const enochianLevel = input.at('enochianLevel').positiveInteger()
  if (enochianLevel > maxLevel)
    input.at('enochianLevel').fail(`${enochianLevel} is above the maximum level ${maxLevel}`)
  const maxStacks = readLevelTable(input.at('maxStacks'), 'value', maxLevel, (value) => {
    const stacks = value.positiveInteger()
    if (stacks > 3) value.fail(`must be 1 to 3, got ${stacks}`)
    return stacks
  })

  const seen = new Set<number>()
  const actions = input
    .at('actions')
    .array(true)
    .map((entry) => {
      entry.object(['id', 'change'])
      const id = entry.at('id').positiveInteger()
      if (seen.has(id)) entry.at('id').fail(`action ${id} is listed more than once`)
      seen.add(id)
      const change = readLevelTable(entry.at('change'), 'change', maxLevel, readElementChange, sameChange)
      return { id, change }
    })
  return { classJobs, enochianLevel, maxStacks, actions }
}

/** A file of ClassJobActions; the paths of its errors start with the name */
export interface ClassJobActionsFile {
  name: string
  content: unknown
}

/** Whether two JSON values are the same: arrays item by item in order, objects key by key */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => sameJson(item, b[i]))
  if (!isObject(a) || !isObject(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
}

/** The ID of an entry; parsePeriodicDefs checks the rest of it */
function entryId(entry: Reader): number {
  if (!isObject(entry.value)) entry.fail(`expected an object, got ${describe(entry.value)}`)
  return entry.at('id').positiveInteger()
}

/** The job comes from the classJob of the file, and an entry must not give it again */
function rejectJob(entry: Reader): void {
  if (isObject(entry.value) && Object.hasOwn(entry.value, 'job')) {
    entry.at('job').fail('is given by the classJob of the file')
  }
}

/** The fields of an action that each file listing it must give alike, besides its mark */
const SHARED_ACTION_FIELDS = ['category', 'attackType', 'forced'] as const

/** An action that is a raid buff or a party mitigation, and how long its effect lasts in seconds */
interface ActionMark {
  kind: 'raidBuff' | 'partyMitigation'
  duration: number
}

/** The raidBuff or partyMitigation of an action, which takes a duration; null for neither */
function readActionMark(entry: Reader, keys: Set<string>): ActionMark | null {
  const raidBuff = keys.has('raidBuff') && entry.at('raidBuff').isTrue()
  const partyMitigation = keys.has('partyMitigation') && entry.at('partyMitigation').isTrue()
  if (raidBuff && partyMitigation) entry.at('partyMitigation').fail('cannot be given with raidBuff')
  if (!raidBuff && !partyMitigation) {
    if (keys.has('duration')) entry.at('duration').fail('is only for raidBuff or partyMitigation')
    return null
  }
  const kind = raidBuff ? 'raidBuff' : 'partyMitigation'
  if (!keys.has('duration')) entry.at('duration').fail(`is required for ${kind}`)
  return { kind, duration: entry.at('duration').positiveInteger() }
}

/**
 * Merges the files of ClassJobActions into the statuses, actions, sampleActions and actionTypes of parsePeriodicDefs,
 * and the raid buff and party mitigation marks. A file holds one class or job: its statuses, and its actions by
 * ascending ID with their category and attack type, and their calibration, forced result and sample potencies when
 * they have them; the entries leave out the job, which the classJob of the file gives. A status that is a raid buff has
 * raidBuff: true; an action that is a raid buff or a party mitigation has raidBuff: true or partyMitigation: true, and
 * the duration of its effect in seconds. A status or an action several classes and jobs have, as those of the role
 * actions, is in the file of each: the status the same in every file, the action with the same category, attack type,
 * forced result and mark. The calibrations and the sample potencies are those of the job of the file. The errors of
 * parsePeriodicDefs in a merged entry give its path in its file.
 * @throws PeriodicDefsError
 */
export function mergeClassJobActions(files: readonly ClassJobActionsFile[]) {
  const classJobs = new Map<number, string>()
  const firstStatuses = new Map<number, { path: string; content: Record<string, unknown>; raidBuff: boolean }>()
  const firstActions = new Map<number, { entry: Reader; mark: ActionMark | null }>()
  /** The actions whose forced result an entry of actions already gives, which parsePeriodicDefs takes only once */
  const forcedGiven = new Set<number>()
  const statuses: object[] = []
  const actions: object[] = []
  const sampleActions: object[] = []
  const actionTypes: { id: number }[] = []
  const raidBuffStatuses: number[] = []
  const raidBuffActions: [number, number][] = []
  const partyMitigations: [number, number][] = []
  const from = <T extends object>(entry: Reader, value: T): T => {
    origins.set(value, entry.path)
    return value
  }

  for (const file of files) {
    const root = new Reader(file.content, file.name)
    root.object(['classJob', 'statuses', 'actions'])
    const job = root.at('classJob').positiveInteger()
    const other = classJobs.get(job)
    if (other !== undefined) root.at('classJob').fail(`class or job ${job} is also that of ${other}`)
    classJobs.set(job, file.name)

    for (const entry of root.at('statuses').array()) {
      const id = entryId(entry)
      const periodic = entry.at('periodic')
      rejectJob(periodic)
      const { raidBuff: _raidBuff, ...content } = entry.value as Record<string, unknown>
      const raidBuff = Object.hasOwn(entry.value as object, 'raidBuff') && entry.at('raidBuff').isTrue()
      const first = firstStatuses.get(id)
      if (first) {
        if (!sameJson(first.content, content)) entry.fail(`status ${id} differs from ${first.path}`)
        if (first.raidBuff !== raidBuff) entry.at('raidBuff').fail(`must be the same as in ${first.path}`)
        continue
      }
      firstStatuses.set(id, { path: entry.path, content, raidBuff })
      if (raidBuff) raidBuffStatuses.push(id)
      const status = { ...content }
      if (isObject(periodic.value)) status.periodic = { ...periodic.value, job }
      statuses.push(from(entry, status))
    }

    let last = 0
    for (const entry of root.at('actions').array()) {
      const id = entryId(entry)
      if (id <= last) entry.at('id').fail('IDs must ascend')
      last = id
      rejectJob(entry)
      const keys = entry.object(
        ['id', 'category', 'attackType'],
        ['raidBuff', 'partyMitigation', 'duration', 'calibration', 'forced', 'potency'],
      )
      rejectJob(entry.at('calibration'))
      const { category, attackType, calibration, forced, potency } = entry.value as Record<string, unknown>
      const mark = readActionMark(entry, keys)

      const first = firstActions.get(id)
      if (first) {
        const where = `must be the same as in ${first.entry.path}`
        for (const field of SHARED_ACTION_FIELDS) {
          const value = (first.entry.value as Record<string, unknown>)[field]
          if (!sameJson(value, (entry.value as Record<string, unknown>)[field])) entry.at(field).fail(where)
        }
        // The mark one of the two has and the other has not, or else the duration
        if (mark?.kind !== first.mark?.kind) entry.at(mark?.kind ?? first.mark?.kind ?? 'raidBuff').fail(where)
        if (mark?.duration !== first.mark?.duration) entry.at('duration').fail(where)
      } else {
        firstActions.set(id, { entry, mark })
        actionTypes.push(from(entry, { id, category, attackType }))
        if (mark) (mark.kind === 'raidBuff' ? raidBuffActions : partyMitigations).push([id, mark.duration])
      }

      const giveForced = keys.has('forced') && !forcedGiven.has(id)
      if (giveForced) forcedGiven.add(id)
      if (keys.has('calibration')) {
        actions.push(from(entry, giveForced ? { id, job, calibration, forced } : { id, job, calibration }))
      } else if (giveForced) {
        actions.push(from(entry, { id, forced }))
      }
      if (keys.has('potency')) sampleActions.push(from(entry, { id, job, potency }))
    }
  }

  actionTypes.sort((a, b) => a.id - b.id)
  return {
    statuses: { statuses },
    actions: { actions },
    sampleActions: { actions: sampleActions },
    actionTypes: { actions: actionTypes },
    raidBuffStatuses,
    raidBuffActions,
    partyMitigations,
  }
}

/**
 * statuses, actions, sampleActions and actionTypes are what mergeClassJobActions returns. requirePotency defaults to
 * true; with false, the potency tables periodic-potency.mjs fills may be left out and are empty in the result, the
 * action types and level-modifiers.json may be empty, and the actions are not looked up in the action types.
 * periodic-potency.mjs reads the files it fills this way.
 * @throws PeriodicDefsError
 */
export function parsePeriodicDefs(
  input: {
    version: unknown
    statuses: unknown
    actions: unknown
    sampleActions: unknown
    actionTypes: unknown
    /** The marks mergeClassJobActions checked, taken as they are; none when left out */
    raidBuffStatuses?: readonly number[]
    /** Action ID and seconds */
    raidBuffActions?: readonly (readonly [number, number])[]
    /** Action ID and seconds */
    partyMitigations?: readonly (readonly [number, number])[]
    /** The content of level-modifiers.json */
    levelModifiers: unknown
    gauge: readonly GaugeModifier[]
    elements: ElementRules
  },
  options: { requirePotency?: boolean } = {},
): PeriodicDefs {
  const requirePotency = options.requirePotency ?? true
  const version = readVersion(new Reader(input.version, 'version'))
  const { maxLevel } = version
  // The paths start with the name of the file, as statuses[3].modifiers[0].scope
  const statuses = readStatuses(new Reader(input.statuses, ''), maxLevel, requirePotency)
  const actions = readActions(new Reader(input.actions, ''), maxLevel, requirePotency)
  const sampleActions = readSampleActions(new Reader(input.sampleActions, 'sampleActions'), maxLevel)
  const actionTypes = readActionTypes(new Reader(input.actionTypes, 'actionTypes'), requirePotency)
  const levelModifiers = readLevelModifiers(
    new Reader(input.levelModifiers, 'levelModifiers'),
    maxLevel,
    requirePotency,
  )
  const gauge = readGauge(new Reader(input.gauge, 'gauge'), maxLevel)
  const elements = readElements(new Reader(input.elements, 'elements'), maxLevel)

  for (const { path, kind, job } of statuses.jobs) {
    const calibrated = [...actions.calibration.values()].flat().some((item) => item.kind === kind && item.job === job)
    if (!calibrated) path.fail(`job ${job} has no ${kind} calibration action in actions`)
  }
  if (requirePotency) {
    for (const { path, id } of [...statuses.actionRefs, ...actions.actionRefs, ...sampleActions.actionRefs]) {
      if (!actionTypes.has(id)) path.fail(`action ${id} is not listed in the action types`)
    }
  }

  return {
    ...version,
    periodic: statuses.periodic,
    modifiers: statuses.modifiers,
    calibration: actions.calibration,
    samples: sampleActions.samples,
    actionTypes,
    raidBuffStatuses: new Set(input.raidBuffStatuses ?? []),
    raidBuffActions: new Map(input.raidBuffActions ?? []),
    partyMitigations: new Map(input.partyMitigations ?? []),
    levelModifiers,
    gauge,
    elements,
    forced: actions.forced,
  }
}
