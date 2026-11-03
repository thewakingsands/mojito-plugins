import {
  ENTRY_FIELDS,
  type EntryField,
  HIT_CRITICAL,
  HIT_DIRECT,
  HIT_DIRECT_HIT,
  type ReplayActor,
  type ReplayData,
} from '../../view-model.js'

/** A span of review time, from included and to excluded */
export interface Span {
  from: number
  to: number
}
/** What the tables sum over */
export interface Scope {
  /** The chosen members, by actor index */
  chosen: ReadonlySet<number>
  /** null for the whole fight */
  span: Span | null
  /** The length of the span; for the whole fight, the duration of its summary, as the overview divides by it */
  lengthMs: number
  mergePets: boolean
}

const FIELD = Object.fromEntries(ENTRY_FIELDS.map((field, index) => [field, index])) as Record<EntryField, number>
export const inSpan = (t: number, span: Span | null) => span === null || (t >= span.from && t < span.to)
const perSecond = (total: number, lengthMs: number) => (lengthMs > 0 ? (total * 1000) / lengthMs : null)
const ratio = (part: number, whole: number) => (whole !== 0 ? part / whole : null)
function ensure<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key)
  if (value === undefined) {
    value = create()
    map.set(key, value)
  }
  return value
}

/** The row an entry counts on: a pet merges into its owner when the setting says so */
export function rowOf(actors: readonly ReplayActor[], index: number, mergePets: boolean) {
  const actor = actors[index]
  return mergePets && actor.kind === 'pet' && actor.owner !== null ? actor.owner : index
}
/** Whether the actor is a chosen member or one of their pets */
function chosenActor(actors: readonly ReplayActor[], chosen: ReadonlySet<number>, index: number) {
  const actor = actors[index]
  return chosen.has(actor.kind === 'pet' && actor.owner !== null ? actor.owner : index)
}

/** Sums of one row or one skill of a row */
interface Sums {
  damage: number
  healing: number
  taken: number
  overheal: number
  /** damage + given + received: the rDPS numerator */
  contribution: number
  received: number
  /** Direct hits, and the critical and direct-hit ones among them; hits counts every amount by its sign */
  direct: number
  critical: number
  directHit: number
  hits: number
}
const sums = (): Sums => ({
  damage: 0,
  healing: 0,
  taken: 0,
  overheal: 0,
  contribution: 0,
  received: 0,
  direct: 0,
  critical: 0,
  directHit: 0,
  hits: 0,
})
function add(target: Sums, field: number, amount: number, hit: number) {
  if (field === FIELD.damage) {
    target.damage += amount
    target.contribution += amount
    target.hits += Math.sign(amount)
    if (hit & HIT_DIRECT) {
      target.direct++
      if (hit & HIT_CRITICAL) target.critical++
      if (hit & HIT_DIRECT_HIT) target.directHit++
    }
  } else if (field === FIELD.healing) {
    target.healing += amount
    target.hits += Math.sign(amount)
  } else if (field === FIELD.taken) {
    target.taken += amount
    target.hits += Math.sign(amount)
  } else if (field === FIELD.overheal) target.overheal += amount
  else {
    target.contribution += amount
    if (field === FIELD.received) target.received += amount
  }
}

interface Grouped {
  sums: Sums
  skills: Map<string, Sums>
  /** Who the amounts went to or came from: targets of healing, sources of taken, by actor index or -1 */
  others: Map<number, Sums>
}
/**
 * Sums the entries of the fields in the span by row, skill and the other actor; key picks the row of an entry. Only
 * the entries of the chosen members and their pets, unless all is set.
 */
function group(
  data: ReplayData,
  scope: Scope,
  fields: readonly EntryField[],
  key: (actor: number) => number,
  all = false,
): Map<number, Grouped> {
  const wanted = new Set(fields.map((field) => FIELD[field]))
  const result = new Map<number, Grouped>()
  const { entries, actors, skills } = data
  for (let i = 0; i < entries.t.length; i++) {
    const field = entries.field[i]
    if (!wanted.has(field) || !inSpan(entries.t[i], scope.span)) continue
    const actor = entries.actor[i]
    if (!all && !chosenActor(actors, scope.chosen, actor)) continue
    const row = key(actor)
    const grouped = ensure(result, row, () => ({ sums: sums(), skills: new Map(), others: new Map() }))
    const ofSkill = ensure(grouped.skills, skills[entries.skill[i]], sums)
    const ofOther = ensure(grouped.others, entries.other[i], sums)
    for (const target of [grouped.sums, ofSkill, ofOther]) add(target, field, entries.amount[i], entries.hit[i])
  }
  return result
}

export interface DamageSkill {
  skill: string
  dps: number | null
  rdps: number | null
  total: number
  critRate: number | null
  directRate: number | null
  /** What the actor's status gave the others: only rDPS */
  given: boolean
}
export interface DamageRow {
  actor: number
  dps: number | null
  rdps: number | null
  total: number
  /** Of the damage and rDPS of every member in the span */
  dpsShare: number | null
  rdpsShare: number | null
  critRate: number | null
  directRate: number | null
  skills: DamageSkill[]
}
const DAMAGE_FIELDS: EntryField[] = ['damage', 'given', 'received']
/** Damage of the chosen members and their pets, highest rDPS first, or highest DPS without rDPS */
export function damageRows(data: ReplayData, scope: Scope, rdps: boolean): DamageRow[] {
  const key = (actor: number) => rowOf(data.actors, actor, scope.mergePets)
  let damage = 0,
    contribution = 0
  for (const { sums } of group(data, scope, DAMAGE_FIELDS, key, true).values()) {
    damage += sums.damage
    contribution += sums.contribution
  }
  const rate = (part: number, sums: Sums) => ratio(part, sums.direct)
  const rows = [...group(data, scope, DAMAGE_FIELDS, key)]
    .filter(([, { sums }]) => sums.damage !== 0 || sums.contribution !== 0)
    .map(([actor, { sums, skills }]): DamageRow => {
      const lines = [...skills]
        .filter(([, skill]) => skill.damage !== 0 || skill.contribution !== 0)
        .map(
          ([skill, line]): DamageSkill => ({
            skill,
            dps: perSecond(line.damage, scope.lengthMs),
            rdps: rdps ? perSecond(line.contribution, scope.lengthMs) : null,
            total: line.damage,
            critRate: rate(line.critical, line),
            directRate: rate(line.directHit, line),
            given: line.received !== 0 && line.damage === 0,
          }),
        )
        .sort((a, b) => b.total - a.total || (b.rdps ?? 0) - (a.rdps ?? 0))
      return {
        actor,
        dps: perSecond(sums.damage, scope.lengthMs),
        rdps: rdps ? perSecond(sums.contribution, scope.lengthMs) : null,
        total: sums.damage,
        dpsShare: ratio(sums.damage, damage),
        rdpsShare: rdps ? ratio(sums.contribution, contribution) : null,
        critRate: rate(sums.critical, sums),
        directRate: rate(sums.directHit, sums),
        skills: lines,
      }
    })
  const order = (row: DamageRow) => (rdps ? (row.rdps ?? 0) : (row.dps ?? 0))
  return rows.sort((a, b) => order(b) - order(a))
}

export interface TakenRow {
  actor: number
  perSecond: number | null
  total: number
  deaths: number
  skills: { skill: string; total: number; hits: number }[]
}
/** Damage the chosen members took, most first */
export function takenByActor(data: ReplayData, scope: Scope): TakenRow[] {
  return [...group(data, scope, ['taken'], (actor) => actor)]
    .map(([actor, { sums, skills }]) => ({
      actor,
      perSecond: perSecond(sums.taken, scope.lengthMs),
      total: sums.taken,
      deaths: data.events.filter(
        (event) => event.kind === 'death' && event.actor === actor && inSpan(event.t, scope.span),
      ).length,
      skills: [...skills]
        .map(([skill, line]) => ({ skill, total: line.taken, hits: line.hits }))
        .filter((line) => line.total !== 0)
        .sort((a, b) => b.total - a.total),
    }))
    .filter((row) => row.total !== 0)
    .sort((a, b) => b.total - a.total)
}

export interface TakenSkillRow {
  skill: string
  total: number
  share: number | null
  hits: number
  /** The members it hit, by actor index */
  targets: number[]
}
/** Damage the chosen members took, by the enemy skill, most first */
export function takenBySkill(data: ReplayData, scope: Scope): TakenSkillRow[] {
  const bySkill = new Map<string, { total: number; hits: number; targets: Set<number> }>()
  for (const [actor, { skills }] of group(data, scope, ['taken'], (actor) => actor))
    for (const [skill, line] of skills) {
      const row = ensure(bySkill, skill, () => ({ total: 0, hits: 0, targets: new Set<number>() }))
      row.total += line.taken
      row.hits += line.hits
      if (line.taken !== 0) row.targets.add(actor)
    }
  const total = [...bySkill.values()].reduce((sum, row) => sum + row.total, 0)
  return [...bySkill]
    .filter(([, row]) => row.total !== 0)
    .map(([skill, row]) => ({
      skill,
      total: row.total,
      share: ratio(row.total, total),
      hits: row.hits,
      targets: [...row.targets],
    }))
    .sort((a, b) => b.total - a.total)
}

export interface HealRow {
  actor: number
  hps: number | null
  total: number
  /** null where the overview has no overheal for the actor */
  overhealRate: number | null
  skills: { skill: string; hps: number | null; total: number; overhealRate: number | null }[]
}
/**
 * Healing of the chosen members and their pets, most first.
 * @param overhealUnknown Rows whose overheal is unavailable in the overview, by actor index
 */
export function healByActor(data: ReplayData, scope: Scope, overhealUnknown: ReadonlySet<number>): HealRow[] {
  const key = (actor: number) => rowOf(data.actors, actor, scope.mergePets)
  const overheal = (actor: number, line: Sums) =>
    overhealUnknown.has(actor) ? null : ratio(line.overheal, line.healing)
  return [...group(data, scope, ['healing', 'overheal'], key)]
    .map(([actor, { sums, skills }]) => ({
      actor,
      hps: perSecond(sums.healing, scope.lengthMs),
      total: sums.healing,
      overhealRate: overheal(actor, sums),
      skills: [...skills]
        .filter(([, line]) => line.healing !== 0)
        .map(([skill, line]) => ({
          skill,
          hps: perSecond(line.healing, scope.lengthMs),
          total: line.healing,
          overhealRate: overheal(actor, line),
        }))
        .sort((a, b) => b.total - a.total),
    }))
    .filter((row) => row.total !== 0)
    .sort((a, b) => b.total - a.total)
}

export interface HealSkillRow {
  skill: string
  total: number
  share: number | null
  hits: number
  /** Who used it, by row */
  users: number[]
}
/** Healing of the chosen members and their pets by skill, most first */
export function healBySkill(data: ReplayData, scope: Scope): HealSkillRow[] {
  const bySkill = new Map<string, { total: number; hits: number; users: Set<number> }>()
  const key = (actor: number) => rowOf(data.actors, actor, scope.mergePets)
  for (const [actor, { skills }] of group(data, scope, ['healing'], key))
    for (const [skill, line] of skills) {
      const row = ensure(bySkill, skill, () => ({ total: 0, hits: 0, users: new Set<number>() }))
      row.total += line.healing
      row.hits += line.hits
      if (line.healing !== 0) row.users.add(actor)
    }
  const total = [...bySkill.values()].reduce((sum, row) => sum + row.total, 0)
  return [...bySkill]
    .filter(([, row]) => row.total !== 0)
    .map(([skill, row]) => ({
      skill,
      total: row.total,
      share: ratio(row.total, total),
      hits: row.hits,
      users: [...row.users],
    }))
    .sort((a, b) => b.total - a.total)
}

/** Healing of the chosen members and their pets by whom it healed, most first; -1 is a target not in the data */
export function healByTarget(data: ReplayData, scope: Scope): { target: number; total: number }[] {
  const byTarget = new Map<number, number>()
  for (const { others } of group(data, scope, ['healing'], () => 0).values())
    for (const [target, line] of others) byTarget.set(target, (byTarget.get(target) ?? 0) + line.healing)
  return [...byTarget]
    .filter(([, total]) => total !== 0)
    .map(([target, total]) => ({ target, total }))
    .sort((a, b) => b.total - a.total)
}
