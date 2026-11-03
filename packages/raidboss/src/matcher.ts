import type { Lang } from '../vendor/cactbot/resources/languages'
import { translateRegexBuildParamAnon } from '../vendor/cactbot/resources/translations'
import type { TimelineReplacement } from '../vendor/cactbot/types/trigger'

export type Fields = Record<string, string | undefined>
export type StructuredEvent = { type: string; fields: Fields }
export type MatchResult = { matches: Record<string, string> } | { missing: string } | null
export class MatchError extends Error {
  constructor(
    readonly status: 'unsupported' | 'needs_completion',
    message: string,
    readonly field?: string,
  ) {
    super(message)
  }
}
// Domains and widths are independent even when their hexadecimal values coincide.
const actor = { width: 8 }
const action = { width: 8 }
const status = { width: 4 }
const marker = { width: 8 }
const tether = { width: 8 }
const territory = { width: 4 }
const raw = { width: 8 }
type FieldKind = 'text' | { width: number }
const supported: Record<string, Record<string, FieldKind>> = {
  StartsUsing: { id: action, sourceId: actor, source: 'text', targetId: actor, target: 'text', castTime: 'text' },
  Ability: {
    id: action,
    sourceId: actor,
    source: 'text',
    targetId: actor,
    target: 'text',
    sequence: raw,
    targetIndex: raw,
  },
  AbilityCancel: { id: action, sourceId: actor, source: 'text' },
  GainsEffect: {
    effectId: status,
    sourceId: actor,
    source: 'text',
    targetId: actor,
    target: 'text',
    duration: 'text',
    count: raw,
  },
  LosesEffect: { effectId: status, sourceId: actor, source: 'text', targetId: actor, target: 'text', count: raw },
  HeadMarker: { id: marker, targetId: actor, target: 'text', data0: raw },
  Tether: { id: tether, sourceId: actor, source: 'text', targetId: actor, target: 'text' },
  ActorControl: { instance: raw, command: raw, data0: raw, data1: raw, data2: raw, data3: raw },
  AddedCombatant: {
    ownerId: actor,
    worldId: raw,
    npcBaseId: 'text',
    npcNameId: 'text',
    id: actor,
    name: 'text',
    job: raw,
    level: raw,
    x: 'text',
    y: 'text',
    z: 'text',
    heading: 'text',
  },
  RemovedCombatant: {
    ownerId: actor,
    worldId: raw,
    npcBaseId: 'text',
    npcNameId: 'text',
    id: actor,
    name: 'text',
    job: raw,
    level: raw,
    x: 'text',
    y: 'text',
    z: 'text',
    heading: 'text',
  },
  MapEffect: { instance: raw, flags: raw, location: raw },
  SpawnNpcExtra: { id: actor, parentId: actor, tetherId: raw, animationState: raw },
  ActorControlExtra: { id: actor, category: raw, param1: raw, param2: raw, param3: raw, param4: raw },
  ActorControlSelfExtra: {
    id: actor,
    category: raw,
    param1: raw,
    param2: raw,
    param3: raw,
    param4: raw,
    param5: raw,
    param6: raw,
  },
  ActorMove: { id: actor, x: 'text', y: 'text', z: 'text', heading: 'text', moveType: raw },
  ActorSetPos: { id: actor, x: 'text', y: 'text', z: 'text', heading: 'text' },
  NameToggle: { id: actor, name: 'text', targetId: actor, targetName: 'text', toggle: raw },
  NpcYell: { npcId: actor, npcNameId: raw, npcYellId: raw },
  BattleTalk2: { npcId: actor, instance: raw, npcNameId: raw, instanceContentTextId: raw, displayMs: 'text' },
  Countdown: { id: actor, worldId: raw, name: 'text', time: 'text' },
  CountdownCancel: { id: actor, worldId: raw, name: 'text' },
  WasDefeated: { sourceId: actor, source: 'text', targetId: actor, target: 'text' },
  CombatantMemory: { id: actor, change: 'text' },
  ChangeZone: { id: territory },
  InCombat: { inGameCombat: 'text' },
}

for (const type of ['StartsUsing', 'Ability'])
  Object.assign(supported[type]!, {
    x: 'text',
    y: 'text',
    z: 'text',
    heading: 'text',
    targetX: 'text',
    targetY: 'text',
    targetZ: 'text',
    targetHeading: 'text',
  })
supported.NetworkCancelAbility = supported.AbilityCancel!
supported.NetworkAOEAbility = supported.Ability!
supported.StartsUsingExtra = { sourceId: actor, id: action, x: 'text', y: 'text', z: 'text', heading: 'text' }
supported.AbilityExtra = {
  sourceId: actor,
  id: action,
  globalEffectCounter: raw,
  dataFlag: raw,
  animationTargetId: actor,
  x: 'text',
  y: 'text',
  z: 'text',
  heading: 'text',
}
supported.SystemLogMessage = { instance: raw, id: raw, param0: raw, param1: raw, param2: raw }
supported.NetworkEffectResult = { id: actor, name: 'text', sequenceId: raw, currentHp: 'text', maxHp: 'text' }

export interface Matcher {
  type: string
  conditions: Readonly<Record<string, unknown>>
  missingTranslations: string[]
  match(event: StructuredEvent): MatchResult
}

export function compileMatcher(
  type: unknown,
  input: unknown,
  language: Lang = 'en',
  replacements: TimelineReplacement[] = [],
): Matcher {
  if (typeof type !== 'string' || !Object.hasOwn(supported, type))
    throw new MatchError('unsupported', `Unsupported event type: ${String(type)}`)
  if (!input || typeof input !== 'object' || Array.isArray(input) || input instanceof RegExp)
    throw new MatchError(
      'needs_completion',
      'Supply structured type/netRegex conditions; whole-line regex is unavailable',
    )
  const pairFields = new Set<string>()
  const original = structuredClone(input) as Record<string, unknown>
  if (type === 'CombatantMemory' && original.pair !== undefined) {
    if (!Array.isArray(original.pair)) throw new MatchError('needs_completion', 'pair must be an array')
    const keys = [
      'Name',
      'Job',
      'Level',
      'CurrentHP',
      'MaxHP',
      'CurrentMP',
      'MaxMP',
      'PosX',
      'PosY',
      'PosZ',
      'Heading',
      'BNpcID',
      'BNpcNameID',
      'WeaponId',
      'ModelStatus',
      'IsCasting1',
      'CastBuffID',
    ]
    for (const pair of original.pair) {
      if (
        !pair ||
        typeof pair !== 'object' ||
        !keys.includes(pair.key) ||
        Object.keys(pair).some((key) => !['key', 'value'].includes(key))
      )
        throw new MatchError('unsupported', 'Unsupported CombatantMemory pair')
      const key = `pair${pair.key}`
      if (Object.hasOwn(original, key)) throw new MatchError('needs_completion', 'Duplicate pair key')
      pairFields.add(key)
      original[key] = pair.value
    }
    delete original.pair
  }
  for (const [field, value] of Object.entries(original)) {
    if (field === 'capture') {
      if (typeof value !== 'boolean') throw new MatchError('needs_completion', 'capture must be boolean', field)
    } else {
      if (!Object.hasOwn(supported[type]!, field) && !(type === 'CombatantMemory' && pairFields.has(field)))
        throw new MatchError('unsupported', `Unsupported ${type} field: ${field}`, field)
      if (
        typeof value !== 'string' &&
        !(Array.isArray(value) && value.length && value.every((part) => typeof part === 'string'))
      )
        throw new MatchError('needs_completion', 'Expected a string or nonempty string array', field)
    }
  }
  const translated = translateRegexBuildParamAnon(
    original as Record<string, string | string[] | boolean>,
    language,
    replacements,
  )
  const conditions = Object.freeze(translated.params)
  const checks: { field: string; check: (value: string) => boolean }[] = []
  for (const [field, value] of Object.entries(conditions)) {
    if (field === 'capture') continue
    const kind = supported[type][field] ?? 'text'
    const values = typeof value === 'string' ? [value] : (value as string[])
    if (kind !== 'text') {
      const valid = new RegExp(`^[0-9a-fA-F]{1,${kind.width}}$`)
      for (const part of values)
        if (/^[A-Za-z0-9]+$/.test(part) && !valid.test(part))
          throw new MatchError('needs_completion', 'Invalid hexadecimal ID', field)
      try {
        const patterns = values.map((part) =>
          /^[0-9a-fA-F]+$/.test(part)
            ? (actual: string) => Number.parseInt(actual, 16) === Number.parseInt(part, 16)
            : (
                (pattern: RegExp) => (actual: string) =>
                  pattern.test(actual) || pattern.test(actual.replace(/^0+(?=.)/, ''))
              )(new RegExp(`^(?:${part})$`, 'i')),
        )
        checks.push({ field, check: (actual) => patterns.some((pattern) => pattern(actual)) })
      } catch {
        throw new MatchError('needs_completion', 'Invalid ID expression', field)
      }
    } else {
      try {
        if (values.some((value) => /\(\?<[^=!]/.test(value)))
          throw new Error('Additional named captures are unavailable')
        const pattern = new RegExp(`^(?:${values.join('|')})$`, 'i')
        checks.push({ field, check: (actual) => pattern.test(actual) })
      } catch {
        throw new MatchError('needs_completion', 'Invalid field expression', field)
      }
    }
  }
  return {
    type,
    conditions,
    missingTranslations: translated.missingFields ?? [],
    match(event) {
      if (event.type !== type) return null
      for (const { field, check } of checks) {
        const value = event.fields[field]
        if (value === undefined) return { missing: field }
        if (!check(value)) return null
      }
      return {
        matches:
          original.capture === false
            ? {}
            : Object.fromEntries(
                Object.entries(event.fields).filter((entry): entry is [string, string] => entry[1] !== undefined),
              ),
      }
    },
  }
}

export function localizedConditions(trigger: Record<string, unknown>, language: Lang): unknown {
  return trigger[`netRegex${language[0]!.toUpperCase()}${language.slice(1)}`] ?? trigger.netRegex
}
