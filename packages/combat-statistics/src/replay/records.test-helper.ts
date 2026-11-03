import type { Field, GameEvent, Status } from '@ffcafe/mojito-plugin-sdk'
import { castSpace, effect, sample } from '../fixtures.js'
import type { LogRecord, PositionActor } from '../log/types.js'
import { defaults } from '../model.js'

export const field = <V>(value: V) =>
  ({ state: 'ok', value, observedAt: 0, from: 'packet', timeBase: 'packet-unix' }) as Field<V>
export const keyOf = (id: number) => `source:1:1:0:${id}`
let seq = 0
export const packet = () => effect(++seq).packet
export const event = (value: GameEvent, at: number): LogRecord => ({ kind: 'event', sample: sample(value, at) })
/** A hit of source on targets with one action, as one packet */
export function hit(
  at: number,
  source: number,
  targets: number[],
  amount: number,
  options: { actionId?: number; sequence?: number; type?: number } = {},
): LogRecord {
  const value = effect(++seq, amount, source, targets[0], options.type ?? 3)
  value.data.actionId = options.actionId ?? 9
  value.data.sequence = options.sequence ?? seq
  value.data.targets = targets.map((targetId) => ({ ...value.data.targets[0], targetId }))
  return event(value, at)
}
export const status = (statusId: number, sourceActorId: number | null, param = 0): Status => ({
  statusId,
  param,
  sourceActorId,
  durationMs: 30000,
  observedAt: 0,
})
export const changed = (at: number, actorId: number, slot: number, value: Status | null) =>
  event({ type: 'statusChanged', packet: packet(), data: { actorId, slot, status: value } }, at)
export const replaced = (at: number, actorId: number, statuses: Status[]) =>
  event({ type: 'statusesReplaced', packet: packet(), data: { actorId, statuses } }, at)
export const cast = (at: number, casterId: number, actionId: number, durationMs: number) =>
  event(
    { type: 'castStarted', packet: packet(), data: { ...castSpace, casterId, actionId, targetId: null, durationMs } },
    at,
  )
export const died = (at: number, actorId: number) =>
  event({ type: 'actorDied', packet: packet(), data: { actorId, causedByActorId: null } }, at)
export const positions = (t: number, ...actors: [number, number, number?][]): LogRecord => ({
  kind: 'positions',
  t,
  actors: actors.map(
    ([id, x, hpCur = 1000]): PositionActor => ({ id, x, z: 0, rotation: 0, hpCur, hpMax: id === 5 ? null : 1000 }),
  ),
})
export const fightStart = (fight: number, startAt: number): LogRecord => ({
  kind: 'fightStart',
  fight,
  id: `f${fight}`,
  startAt,
  scope: 'party',
})
export const fightEnd = (fight: number, endAt: number): LogRecord => ({
  kind: 'fightEnd',
  fight,
  id: `f${fight}`,
  endAt,
  reason: 'manual',
})

/**
 * Members 1 (paladin), 2 (white mage) and 5 (unknown maximum HP), pet 3 of member 1, the boss 9, an add 8 and an
 * enemy 7 that nobody hits
 */
export function visit(fight: LogRecord[]): LogRecord[] {
  const npc = (id: number, extra: object = {}) => ({
    id,
    name: field(`敌人${id}`),
    objectKind: field(2),
    ownerId: field(null),
    bNpcBase: field(id),
    ...extra,
  })
  return [
    { kind: 'visitStart', visit: 'v', territoryType: 1, zoneName: null, enteredAt: 0, scope: 'party', members: [] },
    {
      kind: 'source',
      value: {
        sessionId: 'source',
        characterGeneration: 1,
        clockGeneration: 1,
        source: 'replay',
        timeBase: 'packet-unix',
        state: 'replay',
        actorId: 1,
        dataLanguage: 'chs',
      } as never,
    },
    { kind: 'settings', value: defaults },
    { kind: 'party', value: { members: field([1, 2, 5].map((id) => ({ id, ownParty: true }))) } as never },
    {
      kind: 'identities',
      origin: 'entities',
      entities: [
        { id: 1, name: field('骑士'), classJob: field(19), objectKind: field(1), ownerId: field(null) },
        { id: 2, name: field('白魔'), classJob: field(24), objectKind: field(1), ownerId: field(null) },
        { id: 5, name: field('诗人'), classJob: field(23), objectKind: field(1), ownerId: field(null) },
        npc(3, { name: field('宠物'), ownerId: field(1) }),
        npc(9),
        npc(8),
        npc(7),
      ],
      missing: [],
    },
    fightStart(0, 1000),
    hit(1000, 1, [9], 100),
    positions(1500, [1, -5]),
    fightEnd(0, 2000),
    fightStart(1, 10_000),
    ...fight,
    fightEnd(1, 30_000),
    fightStart(2, 40_000),
    hit(40_000, 1, [9], 100),
    positions(40_500, [1, 5]),
    cast(40_600, 9, 900, 1000),
    fightEnd(2, 41_000),
  ]
}
