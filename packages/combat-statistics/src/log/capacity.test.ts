import { writeFileSync } from 'node:fs'
import type {
  AttributionDelta,
  AttributionPart,
  DamageAttribution,
  Field,
  GameEvent,
  Limits,
  SessionSnapshot,
} from '@ffcafe/mojito-plugin-sdk'
import { expect, it } from 'vitest'
import { effectSpace, meta, unobserved } from '../fixtures.js'
import type { Actor, Summary } from '../model.js'
import { Recorder } from './recorder.js'
import { fileRows, memoryStorage } from './storage.test-helper.js'
import { LogStore } from './store.js'
import type { LogEvent } from './types.js'

const HOUR = 3_600_000
const FIGHT = 10 * 60_000
const MEMBERS = [1, 2, 3, 4, 5, 6, 7, 8]
const ENEMIES = [100, 101]
const field = <T>(value: T, at = 0): Field<T> => ({
  state: 'ok',
  value,
  observedAt: at,
  from: 'packet',
  timeBase: 'packet-unix',
})

/** An hour of eight-player fighting; withSplits adds the damage splits of the host and their deltas */
async function hour(withSplits: boolean) {
  let seed = 42
  const random = () => {
    seed = (seed * 48271) % 2147483647
    return seed / 2147483647
  }
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]
  const actors = new Map<number, Actor>(
    [...MEMBERS, ...ENEMIES].map((id) => [
      id,
      {
        key: `s:0:${id}`,
        id,
        name: `A${id}`,
        worldId: 1,
        job: 19,
        kind: id < 100 ? 'member' : 'enemy',
        ownerKey: null,
      },
    ]),
  )
  const memory = memoryStorage()
  const limits = { values: { 'storage.pluginBytes': 1024 * 1024 * 1024 } } as unknown as Limits
  const store = new LogStore(memory.storage, limits, 'capacity')
  const recorder = new Recorder({
    sink: store,
    actors: () => actors,
    names: { zone: () => '阿卡狄亚零式登天斗技场4', job: () => '骑士' },
    brief: () => ({ result: 'wipe', mainEnemy: { name: '暗黑领主', hpCur: 1, hpMax: 2, hpPercent: 50 } }),
    positions: () => {},
  })
  recorder.source({
    state: 'live',
    sessionId: 'session',
    characterGeneration: 1,
    clock: { generation: 1, source: 'live', base: 'packet-unix' },
    character: { actorId: 1 },
    dataLanguage: 'chs',
  } as unknown as SessionSnapshot)
  const start = new Date(2026, 9, 26, 20, 0).getTime()
  recorder.zone({ territoryType: field(1263), mapId: field(1) }, start, {
    encounters: {
      localActorId: 1,
      inCombat: null,
      combatValue: null,
      packetSeq: null,
      combatSeq: null,
      combatAt: null,
    },
    generations: [],
  })
  recorder.identities(
    'combatants',
    [...MEMBERS, ...ENEMIES].map((id) => ({ id, name: field(`A${id}`), classJob: field(19) })),
    [],
    new Set(MEMBERS),
    'party',
    start,
  )
  const hp = new Map([...MEMBERS, ...ENEMIES].map((id) => [id, id < 100 ? 100_000 : 50_000_000]))
  const place = new Map([...MEMBERS, ...ENEMIES].map((id) => [id, { x: 100, z: 100, rotation: 0 }]))
  let seq = 0,
    sequence = 0,
    tickId = 0
  const packet = (source: number, target: number) => ({
    seq: ++seq,
    timestamp: 0,
    sourceActorId: source,
    targetActorId: target,
  })
  const event = (value: LogEvent, at: number) => {
    value.packet = value.packet && { ...value.packet, timestamp: at }
    recorder.event({ meta: meta(at), value } as never)
  }
  const summary = { durationMs: FIGHT, rows: [] } as unknown as Summary
  // The splits draw from their own sequence, so the other inputs stay those of the hour without them
  let splitSeed = 7
  const splitRandom = () => {
    splitSeed = (splitSeed * 48271) % 2147483647
    return splitSeed / 2147483647
  }
  let splitId = 0
  let deltas: AttributionDelta[] = []
  /** A quarter of the damage has two buffs of other members in it */
  const split = (
    data: Pick<DamageAttribution, 'origin' | 'actorId' | 'targetId' | 'amount'>,
    packet: GameEvent['packet'],
    at: number,
  ) => {
    const index = MEMBERS.indexOf(data.actorId!)
    const contributions: AttributionPart[] =
      splitRandom() < 0.25
        ? [
            { statusId: 786, sourceId: MEMBERS[(index + 1) % 8], amount: data.amount * 0.04 * splitRandom() },
            { statusId: 1878, sourceId: MEMBERS[(index + 2) % 8], amount: data.amount * 0.05 * splitRandom() },
          ]
        : []
    const id = ++splitId
    event(
      {
        type: 'damageAttributed',
        ...(packet ? { packet } : {}),
        data: {
          estimatorGeneration: 1,
          id,
          ...data,
          attackerId: data.actorId,
          retained: data.amount - contributions.reduce((sum, part) => sum + part.amount, 0),
          unattributed: 0,
          contributions,
        },
      },
      at,
    )
    if (contributions.length)
      deltas.push({
        id,
        tickId: null,
        actorId: data.actorId,
        origin:
          data.origin.type === 'action'
            ? { type: 'action', actionId: data.origin.actionId }
            : { type: 'tick', statusId: data.origin.statusId },
        unattributed: 0,
        contributions: contributions.map((part) => ({ ...part, amount: part.amount * (splitRandom() - 0.5) * 0.1 })),
      })
  }
  for (let fightStart = start + 1000; fightStart < start + HOUR; fightStart += FIGHT) {
    const id = `enc-${fightStart}`
    recorder.fightStarted({ id, at: fightStart })
    for (let ms = 0; ms < FIGHT - 1000; ms += 250) {
      const at = fightStart + ms
      // About ten action effects a second, three in ten hitting all eight members or coming from them.
      for (let i = 0; i < 2 + (random() < 0.5 ? 1 : 0); i++) {
        const aoe = random() < 0.3
        const source = aoe ? pick(ENEMIES) : pick(MEMBERS)
        const targets = aoe ? MEMBERS : [pick(ENEMIES)]
        const action = ++sequence
        const effect: GameEvent<'actionEffect'> = {
          type: 'actionEffect',
          packet: packet(source, targets[0]),
          data: {
            ...effectSpace,
            sourceActorId: source,
            actionId: 1000 + Math.floor(random() * 40),
            actionType: 1,
            sequence: action,
            isAoe: aoe,
            targets: targets.map((target, targetIndex) => ({
              targetPosition: unobserved,
              targetId: target,
              targetIndex,
              effects: [
                {
                  effectIndex: 0,
                  typeCode: 3,
                  critical: random() < 0.25,
                  direct: random() < 0.3,
                  rawFlags: 0,
                  rawParam: 0,
                  rawValue: Math.floor(random() * 60_000),
                  rawBonusPercent: 0,
                },
              ],
            })),
          },
        }
        event(effect, at)
        if (withSplits && !aoe)
          for (const target of effect.data.targets)
            split(
              {
                origin: { type: 'action', actionId: effect.data.actionId, sequence: action },
                actorId: source,
                targetId: target.targetId,
                amount: target.effects[0].rawValue,
              },
              effect.packet,
              at,
            )
        for (const target of targets) {
          hp.set(target, Math.max(1, hp.get(target)! - Math.floor(random() * 5000)))
          event(
            {
              type: 'hpChanged',
              packet: packet(target, target),
              data: {
                origin: 'effectResult' as const,
                actorId: target,
                hpCur: hp.get(target)!,
                hpMax: target < 100 ? 100_000 : 50_000_000,
                sequence: action,
              },
            },
            at,
          )
        }
      }
      if (ms % 1000 === 0) {
        // One or two periodic ticks per member every three seconds.
        for (const member of MEMBERS)
          if (random() < (0.5 / 3) * 2) {
            const periodic: GameEvent<'periodicTick'> = {
              type: 'periodicTick',
              data: {
                estimatorGeneration: 1,
                tickId: ++tickId,
                occurredAt: at,
                target: pick(ENEMIES),
                isHeal: false,
                statusId: 0,
                total: Math.floor(random() * 20_000),
                unknown: 0,
                confirmed: true,
                phase: 'realtime',
                shares: [
                  {
                    sourceId: member,
                    statusId: 1200 + member,
                    amount: Math.floor(random() * 20_000),
                    basis: 'exact',
                  },
                ],
              },
            }
            event(periodic, at)
            const [share] = periodic.data.shares
            if (withSplits)
              split(
                {
                  origin: { type: 'tick', tickId: periodic.data.tickId, statusId: share.statusId },
                  actorId: member,
                  targetId: periodic.data.target,
                  amount: share.amount,
                },
                undefined,
                at,
              )
          }
        // About five status changes a second.
        for (let i = 0; i < 5; i++)
          event(
            {
              type: 'statusChanged',
              packet: packet(1, 1),
              data: {
                actorId: pick([...MEMBERS, ...ENEMIES]),
                slot: Math.floor(random() * 30),
                status:
                  random() < 0.3
                    ? null
                    : {
                        statusId: 1000 + Math.floor(random() * 50),
                        param: 0,
                        sourceActorId: pick(MEMBERS),
                        durationMs: 15_000,
                        observedAt: at,
                      },
              },
            },
            at,
          )
      }
      // Four position samples a second for ten actors; a moving actor changes every sample.
      recorder.positions({
        meta: meta(at),
        value: {
          missingIds: [],
          entities: [...place].map(([actor, where]) => {
            if (random() < 0.5) {
              where.x += (random() - 0.5) * 2
              where.z += (random() - 0.5) * 2
              where.rotation = (random() - 0.5) * 6.28
            }
            return {
              id: actor,
              position: field({ x: where.x, y: 0, z: where.z }, at),
              rotation: field(where.rotation, at),
              hpCur: field(hp.get(actor)!, at),
              hpMax: field(actor < 100 ? 100_000 : 50_000_000, at),
            }
          }),
        },
      })
      if (ms % 10_000 === 0) await store.flush()
    }
    recorder.fightEnded({ id, reason: 'quiet', at: fightStart + FIGHT - 1000, summary })
    recorder.flushBoundaries()
    // The window of the host closes after the fight, its deltas in batches as the host sends them
    for (let start = 0; start < deltas.length; start += 256)
      event(
        { type: 'attributionRevision', data: { estimatorGeneration: 1, records: deltas.slice(start, start + 256) } },
        fightStart + FIGHT - 500,
      )
    deltas = []
    await store.flush()
  }
  recorder.stop(start + HOUR)
  await store.flush()
  const files = [...memory.files].filter(([name]) => name.startsWith('log/'))
  const bytes = files.reduce((sum, [, file]) => sum + file.length, 0)
  const kinds: Record<string, number> = {}
  let rows = 0
  for (const [, file] of files)
    for (const row of await fileRows(file)) {
      rows++
      kinds[row.kind] = (kinds[row.kind] ?? 0) + 1
    }
  return { bytesPerHour: bytes, files: files.length, rows, kinds, store }
}

it('measures an hour of eight-player fighting', async () => {
  const { store, ...measurements } = await hour(false)
  if (process.env.MOJITO_CAPACITY_OUTPUT)
    writeFileSync(process.env.MOJITO_CAPACITY_OUTPUT, JSON.stringify(measurements, null, 2))
  expect(store.index.entries.get([...store.index.entries.keys()][0])?.fights.every((fight) => !fight.truncated)).toBe(
    true,
  )
}, 300_000)
// The splits make the log larger; this only measures them (MJT-112)
it('measures the same hour with the damage splits of the host', async () => {
  const { store: _, ...measurements } = await hour(true)
  if (process.env.MOJITO_CAPACITY_OUTPUT)
    writeFileSync(`${process.env.MOJITO_CAPACITY_OUTPUT}.splits.json`, JSON.stringify(measurements, null, 2))
  expect(measurements.kinds.attributed).toBeGreaterThan(0)
  expect(measurements.kinds.attributionRevision).toBeGreaterThanOrEqual(6)
}, 300_000)
