import type { Field, Sample, SourceMeta } from '@ffcafe/mojito-plugin-sdk'
import type { DamageAttribution, GameEvent, PeriodicTick } from './combat-events.js'
import { Identities } from './identity.js'
import type { Actor } from './model.js'
export const actors = () =>
  new Map<number, Actor>([
    [1, { key: 'source:1:1', id: 1, name: '同名', worldId: 1, job: 19, kind: 'member', ownerKey: null }],
    [2, { key: 'source:1:2', id: 2, name: '同名', worldId: 2, job: 24, kind: 'member', ownerKey: null }],
    [3, { key: 'source:1:3', id: 3, name: '宠物', worldId: null, job: null, kind: 'pet', ownerKey: 'source:1:1' }],
    [9, { key: 'source:1:9', id: 9, name: '目标', worldId: null, job: null, kind: 'enemy', ownerKey: null }],
    [10, { key: 'source:1:10', id: 10, name: '队外', worldId: 1, job: 19, kind: 'unknown', ownerKey: null }],
  ])
/** Player 1 in the party list, NPC party member 4 outside it, and enemy 9, as the game reports them */
export const npcParty = () => {
  const ok = <T>(value: T): Field<T> => ({ state: 'ok', value, observedAt: 0, from: 'memory', timeBase: 'packet-unix' })
  const identities = new Identities('source')
  identities.update(
    [
      { id: 1, name: ok('玩家'), classJob: ok(19), objectKind: ok(1), ownerId: ok(null), bNpcBase: ok(0) },
      { id: 4, name: ok('亲信'), objectKind: ok(2), subKind: ok(9), ownerId: ok(null), bNpcBase: ok(1000) },
      { id: 9, name: ok('目标'), objectKind: ok(2), subKind: ok(5), ownerId: ok(null), bNpcBase: ok(2000) },
    ],
    [],
    new Set([1]),
  )
  return identities.actors
}
export const meta = (at: number): SourceMeta => ({
  sessionId: 'source',
  characterGeneration: 1,
  clockGeneration: 1,
  source: 'replay',
  observedAt: at,
  timeBase: 'packet-unix',
  sampleStartedAt: null,
  sampleEndedAt: null,
})
export const effect = (seq: number, value = 100, source = 1, target = 9, type = 3): GameEvent<'actionEffect'> => ({
  type: 'actionEffect',
  packet: { seq, timestamp: seq, sourceActorId: source, targetActorId: target },
  data: {
    ...effectSpace,
    sourceActorId: source,
    actionId: 10,
    actionType: 1,
    sequence: 42,
    isAoe: false,
    targets: [
      {
        targetPosition: unobserved,
        rawEntries: [],
        targetId: target,
        targetIndex: 0,
        effects: [
          {
            effectIndex: 0,
            typeCode: type,
            critical: false,
            direct: false,
            rawFlags: 0,
            rawParam: 0,
            rawValue: value,
            rawBonusPercent: 0,
          },
        ],
      },
    ],
  },
})
export const tick = (patch: Partial<PeriodicTick> = {}): PeriodicTick => ({
  estimatorGeneration: 1,
  tickId: 1,
  occurredAt: 2000,
  target: 9,
  isHeal: false,
  statusId: 0,
  total: 100,
  unknown: 10,
  confirmed: true,
  phase: 'realtime',
  shares: [
    { sourceId: 1, statusId: 1, amount: 50, basis: 'estimated' },
    { sourceId: 10, statusId: 2, amount: 40, basis: 'estimated' },
  ],
  ...patch,
})
export const sample = <T extends GameEvent>(value: T, at: number): Sample<T> => ({
  value: value.packet ? { ...value, packet: { ...value.packet, timestamp: at } } : value,
  meta: meta(at),
})
export const combat = (seq: number, inCombat: boolean, actorId = 1): GameEvent<'playerCombatChanged'> => ({
  type: 'playerCombatChanged',
  packet: { seq, timestamp: seq, sourceActorId: actorId, targetActorId: actorId },
  data: { actorId, inCombat },
})
/** The split of a hit of effect(): 10000 of member 2 on the enemy, 600 of it given by a status of member 1 */
export const attribution = (patch: Partial<DamageAttribution> = {}): DamageAttribution => ({
  estimatorGeneration: 1,
  id: 1,
  origin: { type: 'action', actionId: 10, sequence: 42 },
  attackerId: 2,
  actorId: 2,
  targetId: 9,
  amount: 10000,
  retained: 9300,
  unattributed: 100,
  contributions: [{ statusId: 786, sourceId: 1, amount: 600 }],
  ...patch,
})

export const unobserved = { state: 'unknown', reason: 'Not sampled in fixture' } as const
export const castSpace = {
  sourcePosition: unobserved,
  sourceRotation: unobserved,
  targetPosition: unobserved,
  castPosition: unobserved,
  castRotation: unobserved,
}
export const effectSpace = {
  sourcePosition: unobserved,
  sourceRotation: unobserved,
  effectRotation: unobserved,
  effectPosition: unobserved,
  animationTargetId: null,
  dataFlag: 0,
}
