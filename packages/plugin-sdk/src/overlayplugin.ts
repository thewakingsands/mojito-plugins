import type { ViewsService } from './context.js'
import { check, fields, object, resourcePath, text } from './schema.js'
import type { Json, Value } from './types.js'

export type OverlayProtocol = 'legacy-dom' | 'modern' | 'actws'
export interface OverlayCompatibility {
  kind: 'overlayplugin'
  protocol: OverlayProtocol
  channel: string
  source: { kind: 'package'; entry: string; documents: string[] } | { kind: 'remote'; profileId: string }
}
export interface CombatData {
  Encounter: Record<string, string>
  Combatant: Record<string, Record<string, string>>
  isActive: 'true' | 'false'
}
export type Availability = { state: 'available' | 'partial' | 'unavailable'; reason?: string }
export interface OverlayState {
  apiVersion: 1
  encounterId: string | null
  combatData: CombatData | null
  primaryPlayer: { id: number; name: string } | null
  zone: { id: number; name: string | null } | null
  language: string | null
  inCombat: boolean | null
  availability: Record<'combatData' | 'primaryPlayer' | 'zone' | 'language' | 'inCombat', Availability>
}
export type EndEncounterResult = 'ended' | 'alreadyEnded' | 'staleEncounter' | 'notFound'
export function overlayProtocol(value: unknown): OverlayProtocol {
  check(value === 'legacy-dom' || value === 'modern' || value === 'actws', 'Unknown overlay protocol')
  return value
}
export function overlayCompatibility(input: unknown): OverlayCompatibility {
  const value = object(input)
  fields(value, ['kind', 'protocol', 'channel', 'source'])
  check(value.kind === 'overlayplugin', 'Unknown compatibility kind')
  overlayProtocol(value.protocol)
  const channel = text(value.channel)
  check(
    channel.length <= 128 && [...channel].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127),
    'Invalid channel',
  )
  const source = object(value.source)
  check(source.kind === 'package' || source.kind === 'remote', 'Unknown overlay source')
  if (source.kind === 'package') {
    fields(source, ['kind', 'entry', 'documents'])
    resourcePath(source.entry)
    check(Array.isArray(source.documents) && source.documents.length > 0, 'Missing overlay documents')
    source.documents.forEach(resourcePath)
    check(new Set(source.documents).size === source.documents.length, 'Duplicate overlay document')
    check(source.documents.includes(source.entry), 'Overlay entry must be an allowed document')
  } else {
    fields(source, ['kind', 'profileId'])
    check(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(text(source.profileId)), 'Invalid overlay profile ID')
  }
  return structuredClone(value) as unknown as OverlayCompatibility
}
function strings(input: unknown) {
  const value = object(input)
  for (const entry of Object.values(value)) check(typeof entry === 'string', 'Combat fields must be strings')
}
export function overlayState(input: unknown): OverlayState {
  const value = object(input)
  fields(value, [
    'apiVersion',
    'encounterId',
    'combatData',
    'primaryPlayer',
    'zone',
    'language',
    'inCombat',
    'availability',
  ])
  check(value.apiVersion === 1, 'Unsupported overlay state')
  if (value.encounterId !== null) text(value.encounterId)
  if (value.combatData !== null) {
    const combat = object(value.combatData)
    fields(combat, ['Encounter', 'Combatant', 'isActive'])
    check(combat.isActive === 'true' || combat.isActive === 'false', 'Invalid combat activity')
    check(value.encounterId !== null, 'Combat data requires an encounter ID')
    strings(combat.Encounter)
    for (const actor of Object.values(object(combat.Combatant))) strings(actor)
  }
  for (const key of ['primaryPlayer', 'zone']) {
    if (value[key] === null) continue
    const record = object(value[key])
    fields(record, ['id', 'name'])
    check(typeof record.id === 'number' && Number.isSafeInteger(record.id) && record.id >= 0, 'Invalid identity')
    if (key === 'primaryPlayer' || record.name !== null) text(record.name)
  }
  check(
    value.language === null || ['en', 'de', 'fr', 'ja', 'cn', 'ko'].includes(String(value.language)),
    'Unknown language',
  )
  check(value.inCombat === null || typeof value.inCombat === 'boolean', 'Invalid game combat state')
  const available = object(value.availability)
  fields(available, ['combatData', 'primaryPlayer', 'zone', 'language', 'inCombat'])
  for (const [key, input] of Object.entries(available)) {
    const item = object(input)
    fields(item, ['state', 'reason'], ['state'])
    check(['available', 'partial', 'unavailable'].includes(String(item.state)), 'Invalid availability')
    if (item.state !== 'available') text(item.reason)
    if (item.reason !== undefined) text(item.reason)
    check((value[key] === null) === (item.state === 'unavailable'), 'State and availability disagree')
  }
  return structuredClone(value) as unknown as OverlayState
}
/** A null metric stays absent; formatting never invents zero for unavailable data. */
export function formatMetric(value: number | null, digits = 2): string | undefined {
  if (value === null) return undefined
  check(Number.isFinite(value) && Number.isInteger(digits) && digits >= 0 && digits <= 20, 'Invalid metric')
  return value.toFixed(digits)
}
/**
 * States of the same encounter are merged by `views.set`; when the encounter changes, the previous
 * encounter's last state is flushed first so compatible pages still receive it. Call `views.flush()`
 * when the state has to reach the pages before continuing.
 */
export function overlayProducer(views: ViewsService, channel: string) {
  let encounterId: string | null | undefined
  return {
    async publish(input: OverlayState): Promise<void> {
      const state = overlayState(input)
      if (encounterId !== undefined && state.encounterId !== encounterId) await views.flush()
      encounterId = state.encounterId
      views.set(channel, state as unknown as Value)
    },
    onEnd(handler: (encounterId: string) => EndEncounterResult | Promise<EndEncounterResult>) {
      return views.onCommand(channel, async (input) => {
        const command = object(input)
        fields(command, ['kind', 'encounterId'])
        check(command.kind === 'endEncounter', 'Unknown overlay command')
        const result = await handler(text(command.encounterId))
        check(['ended', 'alreadyEnded', 'staleEncounter', 'notFound'].includes(result), 'Invalid end result')
        return { result } satisfies Json
      })
    },
  }
}
