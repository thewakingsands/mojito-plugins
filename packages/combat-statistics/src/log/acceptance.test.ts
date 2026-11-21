import { writeFileSync } from 'node:fs'
import type { CombatantState, Field, Limits, SessionSnapshot } from '@ffcafe/mojito-plugin-sdk'
import { expect, it } from 'vitest'
import type { GameEvent } from '../combat-events.js'
import { Encounters } from '../encounters.js'
import { effect, sample, tick } from '../fixtures.js'
import { Identities } from '../identity.js'
import type { Summary } from '../model.js'
import { Recorder } from './recorder.js'
import { replay } from './replay.js'
import { memoryStorage } from './storage.test-helper.js'
import { LogStore } from './store.js'

const START = Date.UTC(2026, 0, 1)
const field = <T>(value: T): Field<T> => ({
  state: 'ok',
  value,
  observedAt: START,
  from: 'packet',
  timeBase: 'packet-unix',
})
const limits = { values: { 'storage.pluginBytes': 2 * 1024 ** 3, 'storage.fileBytes': 16 * 1024 ** 2 } } as Limits

it('conserves 24-player fights with pets and revisions through 100 recorded fights and a reopen', async () => {
  const memory = memoryStorage()
  const store = new LogStore(memory.storage, limits, 'synthetic-acceptance')
  const identities = new Identities('source:1:1')
  const members = new Set(Array.from({ length: 24 }, (_, i) => i + 1))
  const entities: CombatantState[] = [...members, 31, 32, 90, ...Array.from({ length: 15 }, (_, i) => i + 100)].map(
    (id) => ({
      id,
      name: field(id <= 2 ? 'Same name' : `Synthetic ${id}`),
      homeWorldId: field(id <= 24 ? id : 0),
      classJob: field(id <= 24 ? 19 : 0),
      objectKind: field(id <= 24 || id === 90 ? 1 : 2),
      ownerId: field(id === 31 ? 1 : id === 32 ? 2 : null),
      bNpcBase: field(id >= 100 ? 1 : 0),
    }),
  )
  identities.update(entities, [], members)
  let id = 0
  const recorder = new Recorder({
    sink: store,
    actors: () => identities.actors,
    names: { zone: () => 'Synthetic duty', job: () => 'Synthetic job' },
    brief: (summary) => ({ result: summary.outcome.result, mainEnemy: summary.outcome.mainEnemy }),
    positions: () => {},
  })
  const encounters = new Encounters(
    () => `synthetic-${++id}`,
    () => {},
    {
      started: (info) => recorder.fightStarted(info),
      ended: (info) => recorder.fightEnded(info),
    },
  )
  encounters.localActorId = 1
  encounters.zone = 1
  encounters.updateActors(identities.actors)
  recorder.source({
    state: 'replay',
    sessionId: 'source',
    characterGeneration: 1,
    clock: { generation: 1, source: 'replay', base: 'packet-unix' },
    character: { actorId: 1 },
    dataLanguage: 'en',
  } as SessionSnapshot)
  recorder.settings(encounters.config)
  recorder.party({ members: field([...members].map((id, slot) => ({ id, slot, ownParty: true }))) } as never, START)
  recorder.zone({ territoryType: field(1), mapId: field(1) }, START, {
    encounters: encounters.carry(),
    generations: [],
  })
  recorder.identities('combatants', entities, [], members, 'party', START)
  let seq = 0
  const send = (event: GameEvent, at: number) => {
    const input = sample(event, at)
    encounters.accept(input, at)
    recorder.event(input as never)
  }
  const bytes: number[] = []
  const expected: Summary[] = []
  for (let fight = 0; fight < 100; fight++) {
    const start = START + 1000 + fight * 240_000
    for (let skill = 0; skill < 150; skill++)
      for (const actor of members) {
        const event = effect(++seq, 100 + skill, actor, 100 + (skill % 15))
        event.data.actionId = 900_000 + skill
        send(event, start + skill * 1000 + actor)
      }
    send(effect(++seq, 100, 31, 100), start + 151_000)
    send(effect(++seq, 100, 32, 101), start + 152_000)
    send(effect(++seq, 500, 2, 1, 4), start + 153_000)
    send(effect(++seq, 70, 100, 1), start + 154_000)
    send(
      { type: 'actorDied', packet: effect(++seq).packet, data: { actorId: 2, causedByActorId: 100 } },
      start + 155_000,
    )
    const periodic = tick({
      tickId: fight + 1,
      occurredAt: start + 156_000,
      target: 100,
      shares: [
        { sourceId: 31, statusId: 1, amount: 50, basis: 'estimated' },
        { sourceId: 90, statusId: 1, amount: 40, basis: 'estimated' },
      ],
    })
    send({ type: 'periodicTick', data: periodic }, start + 156_000)
    send({ type: 'periodicTick', data: periodic }, start + 156_001)
    encounters.finish('manual', start + 157_000)
    recorder.flushBoundaries()
    const revision: GameEvent<'periodicRevision'> = {
      type: 'periodicRevision',
      data: {
        estimatorGeneration: 1,
        ticks: [
          {
            ...periodic,
            phase: 'post',
            shares: [
              { sourceId: 31, statusId: 1, amount: 80, basis: 'exact' },
              { sourceId: 90, statusId: 1, amount: 10, basis: 'exact' },
            ],
          },
        ],
      },
    }
    send(revision, start + 158_000)
    const summary = structuredClone(encounters.snapshot(encounters.completed[0], false)!)
    send(revision, start + 158_001)
    expect(encounters.snapshot(encounters.completed[0], false)).toEqual(summary)
    expect(encounters.completed[0].ledger.pending.size).toBe(0)
    expect(summary.encounterDamage.value).toBe(628_480)
    expect(summary.reportedHealing.value).toBe(500)
    expect(summary.rows.reduce((sum, row) => sum + row.totals.healingTaken, 0)).toBe(500)
    expect(summary.rows.reduce((sum, row) => sum + row.totals.taken, 0)).toBe(70)
    expect(summary.rows.reduce((sum, row) => sum + row.totals.deaths, 0)).toBe(1)
    expect(summary.diagnostics.observedTargetDamage).toBe(628_500)
    expect(summary.diagnostics.outOfScopeDamage + summary.diagnostics.unassignedObservedDamage + 80).toBe(100)
    expect(
      summary.rows
        .filter((row) => row.actor.name === 'Same name')
        .map((row) => row.actor.worldId)
        .sort(),
    ).toEqual([1, 2])
    expect(encounters.snapshot(encounters.completed[0], true)!.encounterDamage).toEqual(summary.encounterDamage)
    expect(summary.rows).toHaveLength(26)
    bytes.push(Buffer.byteLength(JSON.stringify(summary)))
    expected.push(summary)
    // Real logs keep completed facts on disk; release these completed ledgers between synthetic fights too.
    encounters.clearHistory()
    await store.flush()
    expect(store.error).toBeNull()
  }
  recorder.stop(START + 24_000_000)
  await store.flush()
  const reopened = new LogStore(memory.storage, limits, 'synthetic-acceptance')
  await reopened.open()
  const visits = [...reopened.index.entries.values()]
  expect(visits).toHaveLength(1)
  expect(visits[0].fights).toHaveLength(100)
  expect(visits[0].fights.some((fight) => fight.truncated)).toBe(false)
  const replayed = await replay(reopened.read(visits[0].id, false, true))
  expect(replayed).toEqual(expected)
  const sizes = [...memory.files.values()].map((value) => value.byteLength)
  expect(Math.max(...sizes)).toBeLessThan(limits.values['storage.fileBytes']!)
  expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(limits.values['storage.pluginBytes']!)
  const result = {
    input: 'synthetic',
    members: 24,
    pets: 2,
    skillsPerMember: 150,
    targets: 15,
    fights: 100,
    limits: limits.values,
    summaryUtf8: {
      average: bytes.reduce((a, b) => a + b, 0) / bytes.length,
      max: Math.max(...bytes),
      total: bytes.reduce((a, b) => a + b, 0),
    },
    parquet: { files: sizes.length, max: Math.max(...sizes), total: sizes.reduce((a, b) => a + b, 0) },
    checks: { conservation: true, duplicateTicksAndRevisions: true, pendingDrained: true, reopenReplayEqual: true },
  }
  if (process.env.MOJITO_ACCEPTANCE_OUTPUT)
    writeFileSync(process.env.MOJITO_ACCEPTANCE_OUTPUT, JSON.stringify(result, null, 2))
}, 300_000)
