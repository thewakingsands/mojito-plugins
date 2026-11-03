import type { AttributionDelta, DamageAttribution, GameEvent } from '@ffcafe/mojito-plugin-sdk'
import { expect, it } from 'vitest'
import { Encounters } from './encounters.js'
import { actors, attribution, effect, sample, tick } from './fixtures.js'
import type { LedgerEntry } from './ledger.js'

const hp = (seq: number, actorId: number, hpCur: number, hpMax: number | null, sequence: number | null) => ({
  type: 'hpChanged' as const,
  packet: { seq, timestamp: seq, sourceActorId: actorId, targetActorId: actorId },
  data: { origin: 'effectResult' as const, actorId, hpCur, hpMax, sequence },
})
const heal = (seq: number, amount: number, sequence: number) => {
  const event = effect(seq, amount, 2, 1, 4)
  event.data.sequence = sequence
  return event
}
const attributed = (seq: number | null, data: Partial<DamageAttribution>): GameEvent<'damageAttributed'> => ({
  type: 'damageAttributed',
  ...(seq === null ? {} : { packet: effect(seq).packet }),
  data: attribution(data),
})
const revised = (records: AttributionDelta[]): GameEvent<'attributionRevision'> => ({
  type: 'attributionRevision',
  data: { estimatorGeneration: 1, records },
})

/** A fight with direct and periodic damage, a revised tick, a measured heal, damage taken and revised splits */
function fight(observer?: (fightId: string, entry: LedgerEntry) => void) {
  const encounters = new Encounters(
    () => 'battle-1',
    () => {},
    undefined,
    observer,
  )
  encounters.updateActors(actors())
  encounters.localActorId = 1
  const crit = effect(1, 10000, 2)
  crit.data.targets[0].effects[0].critical = true
  const events: [GameEvent, number][] = [
    [crit, 1000],
    [attributed(1, {}), 1000],
    [effect(2, 3000, 9, 1), 1500],
    [hp(3, 1, 5000, 10000, 7), 1600],
    [heal(4, 8000, 8), 1700],
    [hp(5, 1, 10000, 10000, 8), 1800],
    [effect(6, 1000, 3), 1900],
    [{ type: 'periodicTick', data: tick({ phase: 'realtime' }) }, 2000],
    [
      {
        type: 'periodicRevision',
        data: {
          estimatorGeneration: 1,
          ticks: [tick({ phase: 'post', shares: [{ sourceId: 1, statusId: 1, amount: 90, basis: 'exact' }] })],
        },
      },
      2100,
    ],
    [
      attributed(null, {
        id: 2,
        origin: { type: 'tick', tickId: 1, statusId: 1 },
        attackerId: 1,
        actorId: 1,
        amount: 90,
        unattributed: 0,
        contributions: [{ statusId: 786, sourceId: 2, amount: 5 }],
      }),
      2100,
    ],
    [
      revised([
        {
          id: 1,
          tickId: null,
          actorId: 2,
          origin: { type: 'action', actionId: 10 },
          unattributed: 0,
          contributions: [{ statusId: 786, sourceId: 1, amount: -200 }],
        },
      ]),
      2200,
    ],
  ]
  for (const [event, at] of events) encounters.accept(sample(event, at), at)
  encounters.end('battle-1', 3000)
  return encounters.snapshot(encounters.completed[0], false)!
}

it('books every amount of the summary, revisions and taken-back splits included', () => {
  const entries: LedgerEntry[] = []
  const summary = fight((fightId, entry) => {
    expect(fightId).toBe('battle-1')
    entries.push(entry)
  })
  const sum = (key: string, fields: LedgerEntry['field'][]) =>
    entries
      .filter((entry) => entry.actor.key === key && fields.includes(entry.field))
      .reduce((total, entry) => total + entry.amount, 0)
  expect(summary.rows.length).toBeGreaterThan(2)
  for (const row of summary.rows) {
    expect(sum(row.actor.key, ['damage'])).toBe(row.totals.damage)
    expect(sum(row.actor.key, ['healing'])).toBe(row.totals.healing)
    expect(sum(row.actor.key, ['taken'])).toBe(row.totals.taken)
    expect(sum(row.actor.key, ['overheal'])).toBe(row.totals.overhealed)
    expect(sum(row.actor.key, ['damage', 'given', 'received'])).toBe(row.contribution)
  }
  // The revised tick takes back its first booking
  expect(entries.some((entry) => entry.field === 'damage' && entry.amount < 0)).toBe(true)
  expect(entries.find((entry) => entry.field === 'taken')).toMatchObject({ other: 'source:1:9', hit: null })
  expect(entries.find((entry) => entry.field === 'damage')).toMatchObject({
    t: 1000,
    other: 'source:1:9',
    skill: 'action:10',
    hit: { critical: true, direct: false },
  })
  expect(entries.filter((entry) => entry.field === 'received').map((entry) => entry.skill)).toEqual([
    'status:786',
    'status:786',
    'status:786',
  ])
})

it('leaves the summary as it is without an observer', () => {
  expect(fight(() => {})).toEqual(fight())
})
