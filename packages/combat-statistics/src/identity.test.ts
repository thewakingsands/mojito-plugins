import type { CombatantState, Field } from '@ffcafe/mojito-plugin-sdk'
import { expect, it } from 'vitest'
import { actors, effect, tick } from './fixtures.js'
import { Identities } from './identity.js'
import { Ledger } from './ledger.js'

const field = <T>(value: T): Field<T> => ({
  state: 'ok',
  value,
  observedAt: 0,
  from: 'packet',
  timeBase: 'packet-unix',
})
it('distinguishes same names, observed entity lifetimes, confirmed pets and NPCs without inventing owners', () => {
  const identities = new Identities('session:1:1')
  const data: CombatantState[] = [1, 2].map((id) => ({
    id,
    objectKind: field(1),
    name: field('same'),
    homeWorldId: field(id),
    ownerId: field(null),
    bNpcBase: field(0),
  }))
  data.push(
    { id: 3, objectKind: field(2), name: field('pet'), ownerId: field(1), bNpcBase: field(1) },
    { id: 9, objectKind: field(2), ownerId: field(null), bNpcBase: field(123) },
  )
  identities.update(data, [], new Set([1, 2]))
  expect(identities.actors.get(1)?.key).not.toBe(identities.actors.get(2)?.key)
  expect(identities.actors.get(3)).toMatchObject({ kind: 'pet', ownerKey: identities.actors.get(1)?.key })
  expect(identities.actors.get(9)?.kind).toBe('enemy')
  const old = identities.actors.get(1)!.key
  identities.update([], [1], new Set([1, 2]))
  identities.update(data, [], new Set([1, 2]))
  expect(identities.actors.get(1)?.key).not.toBe(old)
})
it('deduplicates exact ticks and preserves old bucket ownership when pet ownership is learned late', () => {
  const data = actors()
  data.get(3)!.ownerKey = null
  data.get(3)!.kind = 'unknown'
  const ledger = new Ledger(data)
  ledger.direct(effect(1, 100, 3), 1000)
  expect(ledger.summary(1000, 1000, true)).toHaveLength(0)
  expect(ledger.diagnostics.outOfScopeDamage).toBe(100)
  const owned = actors()
  ledger.refresh(owned)
  ledger.direct(effect(2, 50, 3), 2000)
  const merged = ledger.summary(1000, 2000, true)
  expect(merged[0].totals.damage).toBe(150)
  expect(ledger.diagnostics.outOfScopeDamage).toBe(0)
  expect(merged[0].metrics.last10Dps.value).toBe(50)
  const ownTick = tick({
    tickId: 2,
    statusId: 10,
    unknown: 0,
    shares: [{ sourceId: 1, statusId: 10, amount: 100, basis: 'exact' }],
  })
  ledger.periodic(ownTick)
  ledger.periodic(ownTick)
  expect(ledger.summary(1000, 2000, true)[0].totals.damage).toBe(250)
})
it('reclassifies every known actor when the scope widens to all players and narrows back', () => {
  const identities = new Identities('session:1:1')
  identities.update(
    [
      { id: 1, name: field('self'), objectKind: field(1), ownerId: field(null), bNpcBase: field(0) },
      { id: 2, name: field('other'), objectKind: field(1), ownerId: field(null), bNpcBase: field(0) },
      { id: 3, name: field('pet'), objectKind: field(2), ownerId: field(2), bNpcBase: field(1) },
      { id: 9, name: field('enemy'), objectKind: field(2), ownerId: field(null), bNpcBase: field(123) },
    ],
    [],
    new Set([1]),
  )
  const members = new Set([1])
  expect(identities.actors.get(2)?.kind).toBe('unknown')
  expect(identities.actors.get(3)?.kind).toBe('unknown')
  const [self, other, pet, enemy] = [1, 2, 3, 9].map((id) => identities.actors.get(id))
  identities.classify(members, true)
  expect(identities.actors.get(2)?.kind).toBe('member')
  expect(identities.actors.get(3)).toMatchObject({ kind: 'pet', ownerKey: identities.actors.get(2)?.key })
  expect(identities.actors.get(9)?.kind).toBe('enemy')
  expect(identities.actors.get(2)).not.toBe(other)
  expect(identities.actors.get(3)).not.toBe(pet)
  expect(identities.actors.get(1)).toBe(self)
  expect(identities.actors.get(9)).toBe(enemy)
  identities.classify(members)
  expect(identities.actors.get(2)?.kind).toBe('unknown')
  expect(identities.actors.get(3)).toMatchObject({ kind: 'unknown', ownerKey: null })
})
it('keeps actor keys after carrying generations into a new instance', () => {
  const identities = new Identities('session:1:1')
  identities.update([{ id: 9, objectKind: field(2), name: field('a') }], [], new Set())
  identities.update([], [9], new Set())
  identities.update([{ id: 9, objectKind: field(2), name: field('b') }], [], new Set())
  const restored = new Identities('session:1:1')
  restored.restore(JSON.parse(JSON.stringify(identities.carry())))
  restored.update([{ id: 9, objectKind: field(2), name: field('b') }], [], new Set())
  expect(restored.actors.get(9)?.key).toBe(identities.actors.get(9)?.key)
  expect(restored.actors.get(9)?.key).toBe('session:1:1:1:9')
})
it('keeps the actor objects and the revision when nothing about the actors changed', () => {
  const identities = new Identities('session:1:1')
  const data: CombatantState[] = [
    {
      id: 1,
      objectKind: field(1),
      name: field('one'),
      homeWorldId: field(1),
      classJob: field(19),
      ownerId: field(null),
      bNpcBase: field(0),
    },
    { id: 3, objectKind: field(2), name: field('pet'), ownerId: field(1), bNpcBase: field(1) },
  ]
  identities.update(data, [], new Set([1]))
  const revision = identities.revision
  const [one, pet] = [identities.actors.get(1), identities.actors.get(3)]
  identities.update(data, [], new Set([1]))
  identities.classify(new Set([1]))
  expect(identities.revision).toBe(revision)
  expect(identities.actors.get(1)).toBe(one)
  expect(identities.actors.get(3)).toBe(pet)

  identities.update([{ ...data[0], name: field('renamed') }], [], new Set([1]))
  expect(identities.revision).toBeGreaterThan(revision)
  const renamed = identities.revision
  identities.update([{ ...data[0], name: field('renamed'), classJob: field(20) }], [], new Set([1]))
  expect(identities.actors.get(1)?.job).toBe(20)
  expect(identities.revision).toBeGreaterThan(renamed)
  const changedJob = identities.revision
  identities.update([], [3], new Set([1]))
  expect(identities.actors.has(3)).toBe(false)
  expect(identities.revision).toBeGreaterThan(changedJob)
})
it('counts NPC party members in every scope by their sub kind and keeps it when a later sample lacks it', () => {
  const identities = new Identities('session:1:1')
  const npc = (id: number, subKind: number): CombatantState => ({
    id,
    name: field(`npc${id}`),
    objectKind: field(2),
    subKind: field(subKind),
    ownerId: field(null),
    bNpcBase: field(100 + id),
  })
  identities.update(
    [
      { id: 1, name: field('self'), objectKind: field(1), ownerId: field(null), bNpcBase: field(0) },
      npc(2, 9),
      npc(9, 5),
      { id: 3, name: field('pet'), objectKind: field(2), subKind: field(2), ownerId: field(2), bNpcBase: field(1) },
    ],
    [],
    new Set([1]),
  )
  const kinds = () => [2, 9, 3].map((id) => identities.actors.get(id)?.kind)
  expect(kinds()).toEqual(['member', 'enemy', 'pet'])
  expect(identities.actors.get(3)?.ownerKey).toBe(identities.actors.get(2)?.key)
  // the party and alliance scopes differ only in the member set, and neither holds NPC party members
  identities.classify(new Set([1, 5]))
  expect(kinds()).toEqual(['member', 'enemy', 'pet'])
  identities.classify(new Set([1]), true)
  expect(kinds()).toEqual(['member', 'enemy', 'pet'])
  identities.update([{ id: 2, hpCur: field(100) }], [], new Set([1]))
  expect(kinds()).toEqual(['member', 'enemy', 'pet'])
})

it('excludes scene objects and unknown kinds even when they resemble a member or enemy', () => {
  const identities = new Identities('source')
  identities.update(
    [
      { id: 1, objectKind: field(1), ownerId: field(null) },
      { id: 2, objectKind: field(2), ownerId: field(null), bNpcBase: field(3) },
      { id: 7, objectKind: field(7), ownerId: field(null), bNpcBase: field(0x1eb0ff) },
      { id: 8, ownerId: field(null), bNpcBase: field(3) },
    ],
    [],
    new Set([1, 7, 8]),
  )
  expect([...identities.actors.keys()]).toEqual([1, 2])
  expect(identities.actors.get(2)?.kind).toBe('enemy')
  identities.update([{ id: 2, objectKind: field(7) }], [], new Set([1]))
  expect(identities.actors.has(2)).toBe(false)
})
