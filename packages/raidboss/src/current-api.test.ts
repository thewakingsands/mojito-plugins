import type { GameEvent, SourceMeta } from '@ffcafe/mojito-plugin-sdk'
import { expect, it } from 'vitest'
import { EntityCache, projectEvent } from './events'
import { compileMatcher } from './matcher'

const meta: SourceMeta = {
  sessionId: 'fixture',
  characterGeneration: 1,
  clockGeneration: 1,
  source: 'replay',
  observedAt: 10000,
  timeBase: 'packet-unix',
  sampleStartedAt: null,
  sampleEndedAt: null,
}
const packet = { seq: 1, timestamp: 10000, sourceActorId: 11, targetActorId: 1 }
it('projects current packet events without requiring removed SDK aliases', () => {
  const cache = new EntityCache()
  const events: GameEvent[] = [
    { type: 'npcSpawn', packet, data: { actorId: 11, parentId: null, tetherId: 228, animationState: 2 } },
    { type: 'actorControl', packet, data: { actorId: 11, category: 34, params: [62, 0, 0, 0], self: false } },
    { type: 'mapEffect', packet, data: { directorId: 123, index: 8, state: 0x20001, timelineIndex: 0 } },
    { type: 'actorPositionSet', packet, data: { actorId: 11, position: { x: 1, y: 2, z: 3 }, rotation: 0.5 } },
  ]
  const projected = events.map((value) => projectEvent({ meta, value }, cache)[0]!)
  expect(projected.map((value) => value.type)).toEqual(['SpawnNpcExtra', 'HeadMarker', 'MapEffect', 'ActorSetPos'])
  expect(projected[0].fields).toMatchObject({ id: '0000000B', tetherId: '00E4', animationState: '02' })
  expect(projected[1].fields).toMatchObject({ targetId: '0000000B', id: '003E' })
  expect(projected[3].fields).toMatchObject({ x: '1', y: '3', z: '2', heading: '0.5' })
  expect(projected.every((value) => value.fields.timestamp === '1970-01-01T00:00:10.000Z')).toBe(true)
})
it('matches structured ID character classes without matching arbitrary log text', () => {
  const matcher = compileMatcher('StartsUsing', { id: '4DD[BC]' })
  expect(matcher.match({ type: 'StartsUsing', fields: { id: '4DDB' } })).not.toBeNull()
  expect(matcher.match({ type: 'StartsUsing', fields: { id: '00004DDC' } })).not.toBeNull()
  expect(matcher.match({ type: 'StartsUsing', fields: { id: 'prefix|4DDB|suffix' } })).toBeNull()
  expect(matcher.match({ type: 'StartsUsing', fields: { id: '4DDA' } })).toBeNull()
})

it('keeps sparse status slots, suppresses unchanged lists and preserves removed values', () => {
  const entities = new EntityCache()
  const status = { statusId: 0xab3, param: 2, sourceActorId: 12, durationMs: 30000, observedAt: 10000, slot: 5 }
  const list: GameEvent<'statusesReplaced'> = {
    type: 'statusesReplaced',
    packet,
    data: { actorId: 11, statuses: [status] },
  }
  const first = projectEvent({ meta, value: list }, entities)
  expect(first.map((event) => event.type)).toEqual(['GainsEffect'])
  expect(first[0]!.fields).toMatchObject({ effectId: 'AB3', sourceId: '0000000C', count: '02', duration: '30' })
  expect(projectEvent({ meta, value: list }, entities)).toEqual([])
  const lost = projectEvent(
    { meta, value: { type: 'statusChanged', packet, data: { actorId: 11, slot: 5, status: null } } },
    entities,
  )
  expect(lost.map((event) => event.type)).toEqual(['LosesEffect'])
  expect(lost[0]!.fields).toMatchObject({ effectId: 'AB3', sourceId: '0000000C' })
  expect(
    projectEvent(
      { meta, value: { type: 'statusChanged', packet, data: { actorId: 11, slot: 5, status: null } } },
      entities,
    ),
  ).toEqual([])
})
it('projects CombatantMemory differences and captures repeat pair values', () => {
  const entities = new EntityCache()
  const field = <T>(value: T) => ({
    state: 'ok' as const,
    value,
    observedAt: 10000,
    timeBase: meta.timeBase,
    from: 'memory' as const,
  })
  const first = entities.snapshot([{ id: 11, name: field('NPC'), modelStatus: field(0) }], meta)
  expect(first.map((event) => event.type)).toEqual(['AddedCombatant', 'CombatantMemory'])
  const changed = entities.snapshot([{ id: 11, name: field('NPC'), modelStatus: field(16384) }], meta)
  expect(changed).toHaveLength(1)
  const matcher = compileMatcher('CombatantMemory', {
    change: 'Change',
    pair: [{ key: 'ModelStatus', value: '16384' }],
  })
  expect(matcher.match(changed[0]!)).toMatchObject({ matches: { pairModelStatus: '16384', id: '0000000B' } })
  expect(entities.snapshot([{ id: 11, name: field('NPC'), modelStatus: field(16384) }], meta)).toEqual([])
  expect(entities.snapshot([], meta).map((event) => event.type)).toEqual(['RemovedCombatant', 'CombatantMemory'])
})

it('names queued events with the latest known entity name', () => {
  const entities = new EntityCache()
  const name = {
    state: 'ok' as const,
    value: 'Original',
    from: 'memory' as const,
    timeBase: meta.timeBase,
    observedAt: 10200,
  }
  entities.observe({ id: 11, name })
  expect(entities.name(11)).toBe('Original')
  entities.observe({ id: 11, name: { ...name, value: 'Changed', observedAt: 10300 } })
  expect(entities.name(11)).toBe('Changed')
})

it('preserves upstream combatant numeric domains for encounter syncs', () => {
  const field = (value: number) => ({
    state: 'ok' as const,
    value,
    from: 'memory' as const,
    timeBase: meta.timeBase,
    observedAt: meta.observedAt,
  })
  const entities = new EntityCache()
  const added = entities.snapshot(
    [
      {
        id: 11,
        level: field(90),
        homeWorldId: field(0),
        bNpcBase: field(12612),
        bNpcName: field(3458),
      },
    ],
    meta,
  )[0]!
  expect(added.fields).toMatchObject({ level: '5A', worldId: '00', npcBaseId: '12612', npcNameId: '3458' })
  expect(
    compileMatcher('AddedCombatant', {
      level: '5A',
      worldId: '00',
      npcBaseId: '12612',
      npcNameId: '3458',
    }).match(added),
  ).not.toBeNull()
})
