import { expect, it } from 'vitest'
import type { GameEvent } from './combat-events.js'
import { actors, attribution, effect, npcParty, sample, tick } from './fixtures.js'
import { Ledger, overhealMetrics } from './ledger.js'
import { REFLECT_SKILL } from './model.js'

it('counts AoE effects separately, preserves expanded values, and keeps names out of identity', () => {
  const ledger = new Ledger(actors())
  const hit = effect(1, 70000)
  hit.data.targets[0].effects[0].critical = true
  hit.data.targets[0].effects[0].direct = true
  hit.data.targets.push({ ...structuredClone(hit.data.targets[0]), targetIndex: 1 })
  ledger.direct(hit, 1000)
  ledger.direct(hit, 1000)
  ledger.direct(effect(2, 0, 1, 9, 1), 2000)
  ledger.direct(effect(3, 0, 1, 9, 7), 3000)
  ledger.direct(effect(4, 10, 2), 4000)
  const rows = ledger.summary(1000, 4000, false)
  expect(rows).toHaveLength(2)
  expect(rows[0].totals).toMatchObject({
    damage: 140000,
    hits: 2,
    swings: 4,
    misses: 1,
    immune: 1,
    crit: 2,
    direct: 2,
    critDirect: 2,
  })
  expect(rows[0].metrics.critPct.value).toBe(100)
  expect(rows[0].maxHit?.amount).toBe(70000)
  expect(rows[0].metrics.effectiveHealing).toEqual({ value: 0, quality: 'observed' })
  expect(rows[1].actor.name).toBe(rows[0].actor.name)
})
it('does not reinterpret special flags and keeps pet deaths out of owner deaths', () => {
  const ledger = new Ledger(actors())
  const special = effect(1, 999)
  special.data.targets[0].effects[0].rawFlags = 0x20
  ledger.direct(special, 1000)
  ledger.direct(effect(2, 30, 3), 1100)
  ledger.direct(effect(3, 20), 1200)
  ledger.direct({ type: 'actorDied', packet: effect(4).packet, data: { actorId: 3, causedByActorId: 9 } }, 1300)
  const separate = ledger.summary(1000, 1300, false),
    merged = ledger.summary(1000, 1300, true)
  expect(merged).toHaveLength(1)
  expect(merged[0].totals).toMatchObject({ damage: 50, deaths: 0, petDeaths: 1 })
  expect(separate.reduce((sum, row) => sum + row.totals.damage, 0)).toBe(50)
  expect(ledger.diagnostics.unknownEffects).toBe(1)
})
it('replaces periodic allocations conservatively, keeps outside/unknown separate, and leaves recent buckets unchanged', () => {
  const ledger = new Ledger(actors())
  ledger.periodic(tick())
  ledger.periodic(tick())
  expect(ledger.summary(1000, 2000, false)[0].totals.damage).toBe(50)
  expect(ledger.periodic(tick({ total: 101, phase: 'post' }), true)).toBe(false)
  expect(
    ledger.periodic(
      tick({
        phase: 'post',
        unknown: 0,
        shares: [
          { sourceId: 1, statusId: 1, amount: 30, basis: 'exact' },
          { sourceId: 10, statusId: 2, amount: 70, basis: 'estimated' },
        ],
      }),
      true,
    ),
  ).toBe(true)
  expect(ledger.diagnostics).toMatchObject({
    observedTargetDamage: 100,
    unassignedObservedDamage: 0,
    outOfScopeDamage: 70,
    invalidRevisions: 1,
  })
  const row = ledger.summary(1000, 2000, false)[0]
  expect(row.totals.damage).toBe(30)
  expect(row.metrics.last10Dps.value).toBe(50)
  expect(ledger.pending.size).toBe(0)
  expect(ledger.periodic(tick({ phase: 'post' }), true)).toBe(false)
})
it('bounds recent values to sixty source seconds and returns null for zero duration', () => {
  const ledger = new Ledger(actors())
  ledger.direct(effect(0), 0)
  expect(ledger.summary(0, 0, false)[0].metrics.encDps.value).toBeNull()
  for (let i = 1; i <= 65; i++) ledger.direct(effect(i), i * 1000)
  const row = ledger.summary(0, 65000, false)[0]
  expect(row.metrics.last10Dps.value).toBe(100)
  expect(row.metrics.last30Dps.value).toBe(100)
  expect(row.metrics.last60Dps.value).toBe(100)
})
it('records reported healing and received amounts without claiming effective healing', () => {
  const ledger = new Ledger(actors())
  ledger.direct(effect(1, 500, 2, 1, 4), 1000)
  ledger.direct(effect(2, 200, 9, 1), 2000)
  const rows = ledger.summary(1000, 2000, false)
  expect(rows.find((r) => r.actor.id === 2)?.metrics.reportedHealing.value).toBe(500)
  expect(rows.find((r) => r.actor.id === 1)?.totals).toMatchObject({ taken: 200, healingTaken: 500 })
})

it('keeps revisions on the original entity lifetime when an actor ID is reused', () => {
  const ledger = new Ledger(actors())
  ledger.periodic(tick())
  const next = actors()
  next.get(1)!.key = 'source:2:1'
  next.get(1)!.name = 'New entity'
  ledger.refresh(next)
  ledger.periodic(
    tick({ phase: 'post', unknown: 0, shares: [{ sourceId: 1, statusId: 1, amount: 100, basis: 'exact' }] }),
    true,
  )
  const rows = ledger.summary(1000, 2000, false)
  expect(rows).toHaveLength(1)
  expect(rows[0].actor.key).toBe('source:1:1')
  expect(rows[0].totals.damage).toBe(100)
})

it('counts periodic damage once and replaces counts when allocation is revised', () => {
  const ledger = new Ledger(actors())
  ledger.direct(effect(1), 1000)
  ledger.periodic(tick())
  expect(ledger.summary(1000, 2000, false)[0].totals).toMatchObject({ damage: 150, hits: 2, swings: 2 })
  expect(ledger.periodic(tick())).toBe(false)
  ledger.periodic(tick({ unknown: 0, shares: [{ sourceId: 1, statusId: 1, amount: 100, basis: 'exact' }] }), true)
  expect(ledger.summary(1000, 2000, false)[0].totals).toMatchObject({ damage: 200, hits: 2, swings: 2 })
  ledger.periodic(tick({ phase: 'post', unknown: 100, shares: [] }), true)
  expect(ledger.summary(1000, 2000, false)[0].totals).toMatchObject({ damage: 100, hits: 1, swings: 1 })
  expect(ledger.periodic(tick())).toBe(false)
})

it('keeps incoming damage counts without expanding actor or pet settlement bounds', () => {
  const ledger = new Ledger(actors())
  ledger.direct(sample(effect(1, 10, 9, 1), 100).value, 100)
  ledger.direct(sample(effect(2, 100, 1, 9), 1000).value, 1000)
  ledger.direct(sample(effect(3, 200, 1, 9), 2000).value, 2000)
  ledger.direct(sample(effect(4, 20, 9, 1), 3000).value, 3000)
  ledger.direct(sample(effect(5, 30, 9, 3), 4000).value, 4000)
  const owner = ledger.summary(100, 4000, true)[0]
  expect(owner).toMatchObject({ firstAt: 1000, lastAt: 2000, totals: { damage: 300, taken: 60 } })
  expect(owner.metrics.dps.value).toBe(300)
  const pet = ledger.summary(100, 4000, false).find((row) => row.actor.id === 3)!
  expect(pet.firstAt).toBe(pet.lastAt)
  expect(pet.metrics.dps.value).toBeNull()
})
it('retracts a pending periodic endpoint without changing the original tick time', () => {
  const ledger = new Ledger(actors())
  ledger.direct(sample(effect(1), 1000).value, 1000)
  const pending = tick({
    occurredAt: 4000,
    unknown: 0,
    shares: [{ sourceId: 1, statusId: 1, amount: 100, basis: 'estimated' }],
  })
  ledger.periodic(pending, false, 3900)
  expect(ledger.summary(1000, 4000, false)[0].lastAt).toBe(3900)
  ledger.periodic(
    { ...pending, phase: 'post', shares: [{ sourceId: 2, statusId: 1, amount: 100, basis: 'exact' }] },
    true,
    9999,
  )
  const rows = ledger.summary(1000, 4000, false)
  expect(rows.find((row) => row.actor.id === 1)).toMatchObject({ firstAt: 1000, lastAt: 1000, totals: { damage: 100 } })
  expect(rows.find((row) => row.actor.id === 2)).toMatchObject({ firstAt: 3900, lastAt: 3900, totals: { damage: 100 } })
  expect(ledger.settlement()?.packetLast).toBe(3900)
  const before = ledger.settlement()
  expect(ledger.periodic({ ...pending, phase: 'post' }, true)).toBe(false)
  expect(ledger.settlement()).toEqual(before)
})
it('retains known outgoing time when a formerly unknown actor becomes a member', () => {
  const ledger = new Ledger(actors())
  ledger.direct(effect(1, 100, 10), 1000)
  expect(ledger.settlement()).toBeNull()
  const updated = actors()
  updated.get(10)!.kind = 'member'
  ledger.refresh(updated)
  expect(ledger.settlement()).toMatchObject({ first: 1000, last: 1000 })
})

it('preserves healing and death qualification even when a packet also contains incoming damage', () => {
  const ledger = new Ledger(actors())
  ledger.direct(effect(1, 10, 9, 1), 1000)
  const mixed = effect(2, 20, 9, 1)
  mixed.data.targets[0].effects.push({ ...mixed.data.targets[0].effects[0], effectIndex: 1, typeCode: 4, rawValue: 0 })
  ledger.direct(sample(mixed, 2000).value, 2000)
  ledger.direct(
    { type: 'actorDied', packet: sample(effect(3), 3000).value.packet, data: { actorId: 1, causedByActorId: 9 } },
    3000,
  )
  expect(ledger.summary(1000, 3000, false)[0]).toMatchObject({
    firstAt: 2000,
    lastAt: 3000,
    hasSettlementTime: true,
    totals: { taken: 30, healingTaken: 0, deaths: 1 },
  })
})

it('shares identity snapshots across thousands of pending ticks and unchanged refreshes', () => {
  const identities = actors()
  for (let id = 20; id < 520; id++) identities.set(id, { ...identities.get(9)!, id, key: `enemy:${id}` })
  const ledger = new Ledger(identities)
  for (let id = 1; id <= 3000; id++) ledger.periodic(tick({ tickId: id }))
  const snapshots = () => new Set([...ledger.pending.values()].map((entry) => entry.actors))
  expect(ledger.pending.size).toBe(3000)
  expect(snapshots().size).toBe(1)
  const original = [...snapshots()][0]
  ledger.refresh(new Map([...identities].map(([id, actor]) => [id, { ...actor }])))
  ledger.periodic(tick({ tickId: 3001 }))
  expect([...snapshots()]).toEqual([original])
  const renamed = new Map([...identities].map(([id, actor]) => [id, { ...actor }]))
  renamed.get(1)!.name = 'Updated synthetic name'
  ledger.refresh(renamed)
  ledger.periodic(tick({ tickId: 3002 }))
  expect(snapshots().size).toBe(1)
  const changed = [...snapshots()][0]
  expect(changed).not.toBe(original)
  expect(changed.get(1)?.name).toBe('Updated synthetic name')
  expect(original.get(1)?.name).not.toBe('Updated synthetic name')
  ledger.seal()
  expect(ledger.pending.size).toBe(0)
})
it('shares old lifetime snapshots without letting a reused ID receive an older tick', () => {
  const ledger = new Ledger(actors())
  ledger.periodic(tick({ tickId: 1 }))
  ledger.periodic(tick({ tickId: 2 }))
  const updated = actors()
  updated.get(2)!.key = 'source:2:2'
  updated.get(2)!.name = 'Replacement actor'
  ledger.refresh(updated)
  ledger.periodic(tick({ tickId: 3 }))
  expect(new Set([...ledger.pending.values()].map((entry) => entry.actors)).size).toBe(2)
  ledger.periodic(
    tick({ tickId: 1, phase: 'post', unknown: 0, shares: [{ sourceId: 2, statusId: 1, amount: 100, basis: 'exact' }] }),
    true,
  )
  const rows = ledger.summary(1000, 2000, false)
  expect(rows.find((row) => row.actor.key === 'source:1:2')?.totals.damage).toBe(100)
  expect(rows.find((row) => row.actor.key === 'source:2:2')).toBeUndefined()
})

it('uses complete packet bounds for personal damage and healing rates', () => {
  const ledger = new Ledger(actors())
  ledger.direct(sample(effect(1, 100), 1000).value, 10000)
  ledger.direct(sample(effect(2, 200), 6331).value, 18000)
  ledger.direct(sample(effect(3, 50, 1, 1, 4), 6331).value, 19000)
  const row = ledger.summary(10000, 19000, false, 5331)[0]
  expect(row).toMatchObject({ firstAt: 1000, lastAt: 6331 })
  expect(row.metrics.dps.value).toBeCloseTo(300 / 5.331, 10)
  expect(row.metrics.hps.value).toBeCloseTo(50 / 5.331, 10)
  expect(row.metrics.encDps.value).toBe(row.metrics.dps.value)
})
it('falls back as a whole when a personal settlement fact lacks packet time', () => {
  const ledger = new Ledger(actors())
  ledger.direct(sample(effect(1, 100), 1000).value, 10000)
  ledger.periodic(
    tick({
      occurredAt: 18000,
      unknown: 0,
      shares: [{ sourceId: 1, statusId: 1, amount: 100, basis: 'exact' }],
    }),
  )
  const row = ledger.summary(10000, 18000, false)[0]
  expect(row).toMatchObject({ firstAt: 10000, lastAt: 18000 })
  expect(row.metrics.dps.value).toBe(25)
})
it('merges pet packet endpoints before calculating personal duration and keeps single facts unavailable', () => {
  const ledger = new Ledger(actors())
  ledger.direct(sample(effect(1, 100), 1000).value, 10000)
  ledger.direct(sample(effect(2, 100), 2000).value, 12000)
  ledger.direct(sample(effect(3, 100, 3), 4000).value, 16000)
  const separate = ledger.summary(10000, 16000, false)
  const pet = separate.find((row) => row.actor.id === 3)!
  expect(pet).toMatchObject({ firstAt: 4000, lastAt: 4000 })
  expect(pet.metrics.dps.value).toBeNull()
  const merged = ledger.summary(10000, 16000, true)[0]
  expect(merged).toMatchObject({ firstAt: 1000, lastAt: 4000, totals: { damage: 300 } })
  expect(merged.metrics.dps.value).toBe(100)
})

const hp = (hpCur: number, hpMax: number | null = 10000) => ({ hpCur, hpMax, at: 0, fromHpUpdate: false })
const heal = (seq: number, amount: number, sequence: number, source = 2, target = 1, actionId = 10) => {
  const event = effect(seq, amount, source, target, 4)
  event.data.sequence = sequence
  event.data.actionId = actionId
  return event
}
const row = (ledger: Ledger, id: number, mergePets = false) =>
  ledger.summary(0, 10000, mergePets).find((item) => item.actor.id === id)!
it('measures direct overheal against the target HP before the EffectResult', () => {
  const ledger = new Ledger(actors())
  ledger.direct(heal(1, 3000, 1), 1000)
  expect(ledger.settleHeal(1, 1, hp(5000), 8000, 10000, 1000)).toBe(true)
  expect(row(ledger, 2).totals).toMatchObject({ healing: 3000, overhealed: 0, unmeasuredHealing: 0 })
  ledger.direct(heal(2, 8000, 2), 1100)
  ledger.settleHeal(2, 1, hp(5000), 10000, null, 1100)
  expect(row(ledger, 2).totals).toMatchObject({ healing: 11000, overhealed: 3000, unmeasuredHealing: 0 })
  ledger.direct(heal(3, 8000, 3), 1200)
  ledger.settleHeal(3, 1, null, 10000, 10000, 1200)
  expect(row(ledger, 2).totals).toMatchObject({ overhealed: 3000, unmeasuredHealing: 8000 })
  expect(row(ledger, 2).skills['action:10']).toMatchObject({
    healing: 19000,
    overhealed: 3000,
    unmeasuredHealing: 8000,
  })
})
it('splits the overheal of one sequence and target by the amount of each heal', () => {
  const ledger = new Ledger(actors())
  ledger.direct(heal(1, 2000, 7, 2, 1, 10), 1000)
  ledger.direct(heal(2, 6000, 7, 1, 1, 11), 1000)
  ledger.settleHeal(7, 1, hp(6000), 10000, 10000, 1000)
  expect(row(ledger, 2).skills['action:10'].overhealed).toBe(1000)
  expect(row(ledger, 1).skills['action:11'].overhealed).toBe(3000)
})
it('leaves nothing changed when no heal waits for the EffectResult', () => {
  const ledger = new Ledger(actors())
  ledger.direct(heal(1, 3000, 1), 1000)
  const before = structuredClone(row(ledger, 2))
  expect(ledger.settleHeal(2, 1, hp(5000), 10000, 10000, 1000)).toBe(false)
  expect(ledger.settleHeal(1, 9, hp(5000), 10000, 10000, 1000)).toBe(false)
  expect(row(ledger, 2)).toEqual(before)
})
it('leaves heals unmeasured after five seconds without an EffectResult, or when sealed', () => {
  const ledger = new Ledger(actors())
  ledger.direct(heal(1, 3000, 1), 1000)
  ledger.direct(effect(2), 6000)
  expect(row(ledger, 2).totals.unmeasuredHealing).toBe(0)
  ledger.direct(effect(3), 6001)
  expect(row(ledger, 2).totals.unmeasuredHealing).toBe(3000)
  expect(ledger.settleHeal(1, 1, hp(5000), 10000, 10000, 6001)).toBe(false)
  ledger.direct(heal(4, 2000, 2), 7000)
  ledger.seal()
  expect(row(ledger, 2).totals.unmeasuredHealing).toBe(5000)
})
it('splits the overheal of a HoT tick by its shares and keeps it across revisions', () => {
  const ledger = new Ledger(actors())
  const hot = tick({
    target: 1,
    isHeal: true,
    total: 1000,
    unknown: 0,
    shares: [
      { sourceId: 2, statusId: 158, amount: 600, basis: 'estimated' },
      { sourceId: 1, statusId: 159, amount: 400, basis: 'estimated' },
    ],
  })
  expect(ledger.periodic(hot, false, 2000, hp(9500))).toBe(true)
  expect(row(ledger, 2).skills['status:158'].overhealed).toBe(300)
  expect(row(ledger, 1).skills['status:159'].overhealed).toBe(200)
  const revised = {
    ...hot,
    shares: [
      { ...hot.shares[0], amount: 1000 },
      { ...hot.shares[1], amount: 0 },
    ],
  }
  expect(ledger.periodic(revised, true)).toBe(true)
  expect(row(ledger, 2).totals.overhealed).toBe(500)
  expect(row(ledger, 1).totals.overhealed).toBe(0)
  ledger.periodic({ ...hot, tickId: 2 }, false, 3000, hp(9500, null))
  expect(row(ledger, 2).totals).toMatchObject({ overhealed: 500, unmeasuredHealing: 600 })
  expect(row(ledger, 1).totals).toMatchObject({ overhealed: 0, unmeasuredHealing: 400 })
})
it('merges the overheal of pets into their owners', () => {
  const ledger = new Ledger(actors())
  ledger.direct(heal(1, 4000, 1, 3, 1, 20), 1000)
  ledger.settleHeal(1, 1, hp(8000), 10000, 10000, 1000)
  ledger.direct(heal(2, 1000, 2, 3, 1, 20), 1100)
  ledger.seal()
  const owner = row(ledger, 1, true)
  expect(owner.totals).toMatchObject({ healing: 5000, overhealed: 2000, unmeasuredHealing: 1000 })
  expect(owner.skills['action:20']).toMatchObject({ overhealed: 2000, unmeasuredHealing: 1000 })
})
it.each([
  [0, 0, 0, false, { value: 0, quality: 'observed' }, { value: 0, quality: 'observed' }],
  [
    1000,
    0,
    1000,
    false,
    { value: null, quality: 'unavailable', reason: '治疗生效时没有目标 HP' },
    { value: null, quality: 'unavailable', reason: '治疗生效时没有目标 HP' },
  ],
  [
    1000,
    200,
    300,
    false,
    { value: 200, quality: 'partial', reason: '部分治疗缺少目标 HP，过量治疗只计算其余部分' },
    { value: 800, quality: 'partial', reason: '部分治疗缺少目标 HP，过量治疗只计算其余部分' },
  ],
  [1000, 200, 0, true, { value: 200, quality: 'partial' }, { value: 800, quality: 'partial' }],
  [
    1000,
    200,
    0,
    false,
    { value: 200, quality: 'estimated', reason: '按治疗生效前收到的目标 HP 推算' },
    { value: 800, quality: 'estimated', reason: '按治疗生效前收到的目标 HP 推算' },
  ],
])(
  'rates healing %d with overheal %d, unmeasured %d, partial %s',
  (healing, overhealed, unmeasured, partial, overheal, effectiveHealing) => {
    expect(overhealMetrics(healing, overhealed, unmeasured, partial)).toEqual({ overheal, effectiveHealing })
  },
)
it('sums the overheal of the skills into the actor', () => {
  const ledger = new Ledger(actors())
  ledger.direct(heal(1, 3000, 1, 2, 1, 10), 1000)
  ledger.direct(heal(2, 5000, 2, 2, 1, 11), 1000)
  ledger.settleHeal(1, 1, hp(9000), 10000, 10000, 1000)
  ledger.settleHeal(2, 1, hp(7000), 10000, 10000, 1000)
  const healer = row(ledger, 2)
  expect(healer.skills['action:10'].overheal).toMatchObject({ value: 2000, quality: 'estimated' })
  expect(healer.skills['action:11'].overheal).toMatchObject({ value: 2000, quality: 'estimated' })
  expect(healer.metrics.overheal.value).toBe(
    Object.values(healer.skills).reduce((sum, skill) => sum + (skill.overheal.value ?? 0), 0),
  )
  expect(healer.metrics.effectiveHealing.value).toBe(4000)
})
it('falls back to the target HP of the actionEffect when no EffectResult arrives', () => {
  const ledger = new Ledger(actors())
  const known = new Map([
    [1, hp(10000)],
    [2, hp(9000)],
  ])
  const hpOf = (id: number) => known.get(id) ?? null
  ledger.direct(heal(1, 3000, 1, 2, 1), 1000, hpOf)
  ledger.direct(heal(2, 3000, 2, 1, 2), 1000, hpOf)
  ledger.direct(heal(3, 3000, 3, 2, 3), 1000, hpOf)
  ledger.direct(effect(4), 6001)
  expect(row(ledger, 2).totals).toMatchObject({ healing: 6000, overhealed: 3000, unmeasuredHealing: 3000 })
  expect(row(ledger, 1).totals).toMatchObject({ healing: 3000, overhealed: 2000, unmeasuredHealing: 0 })
  ledger.direct(heal(5, 1500, 4, 1, 2), 7000, hpOf)
  ledger.seal()
  expect(row(ledger, 1).totals).toMatchObject({ overhealed: 2500, unmeasuredHealing: 0 })
})
/** The effect of effect() with the type, flags and value given, for a second effect on the same target */
const extra = (event: GameEvent<'actionEffect'>, typeCode: number, rawFlags: number, rawValue: number) => {
  event.data.targets[0].effects.push({
    ...event.data.targets[0].effects[0],
    effectIndex: 1,
    typeCode,
    rawFlags,
    rawValue,
  })
  return event
}
it('books a heal flagged as on the source on its caster, and rates the overheal against the caster HP', () => {
  const ledger = new Ledger(actors())
  ledger.direct(extra(effect(1, 5000), 4, 0x80, 2000), 1000)
  const member = row(ledger, 1)
  expect(member.totals).toMatchObject({ damage: 5000, healing: 2000, healingTaken: 2000 })
  expect(member.targets['source:1:1'].healing).toBe(2000)
  expect(member.maxHeal?.amount).toBe(2000)
  expect(ledger.diagnostics.unknownEffects).toBe(0)
  expect(member.metrics.damage.quality).toBe('observed')
  expect(ledger.settleHeal(42, 1, hp(9000), 10000, 10000, 1000)).toBe(true)
  expect(row(ledger, 1).totals).toMatchObject({ overhealed: 1000, unmeasuredHealing: 0 })
})
it('falls back to the caster HP of the actionEffect for a heal on the source without an EffectResult', () => {
  const ledger = new Ledger(actors())
  const hpOf = (id: number) => (id === 1 ? hp(9500) : null)
  ledger.direct(extra(effect(1, 5000), 4, 0x80, 2000), 1000, hpOf)
  ledger.direct(effect(2), 6001)
  expect(row(ledger, 1).totals).toMatchObject({ healing: 2000, overhealed: 1500, unmeasuredHealing: 0 })
})
it('books reflected damage on the member who reflects it, outside the hit counts and buff splits', () => {
  const ledger = new Ledger(actors())
  ledger.direct(extra(effect(1, 5000, 9, 1), 3, 0xa0, 433), 1000)
  ledger.direct(extra(effect(2, 5000, 9, 1), 3, 0xa0, 433), 2000)
  expect(ledger.attributeHit(2, attribution({ actorId: 1, targetId: 9, amount: 433 }), 2000)).toBe(false)
  const [member] = ledger.summary(1000, 2000, false)
  expect(member.totals).toMatchObject({ damage: 866, taken: 10000, swings: 0, hits: 0, crit: 0, direct: 0 })
  expect(member.skills[REFLECT_SKILL]).toMatchObject({ damage: 866, hits: 0, directHits: 0 })
  expect(member.targets['source:1:9'].damage).toBe(866)
  expect(member.maxHit).toBeNull()
  expect(member.metrics.damage.quality).toBe('observed')
  expect(member.metrics.contributionDps.value).toBe(866)
  expect(member.skills[REFLECT_SKILL].contributionDps.value).toBe(866)
  expect(ledger.diagnostics.observedTargetDamage).toBe(866)
})
it('skips effects without amounts, on the target or on the source', () => {
  const ledger = new Ledger(actors())
  ledger.direct(extra(extra(effect(1, 5000), 62, 0x80, 7), 25, 0, 3), 1000)
  expect(ledger.diagnostics.unknownEffects).toBe(0)
  expect(row(ledger, 1).totals).toMatchObject({ damage: 5000, healing: 0 })
})
it('still counts other flags and types as unknown effects and marks the metrics partial', () => {
  const ledger = new Ledger(actors())
  ledger.direct(extra(extra(effect(1, 5000), 3, 0x20, 700), 99, 0, 0), 1000)
  expect(ledger.diagnostics.unknownEffects).toBe(2)
  expect(row(ledger, 1).totals.damage).toBe(5000)
  expect(row(ledger, 1).metrics.damage.quality).toBe('partial')
})
it('gives the parts of a split hit to the statuses of the players who gave them', () => {
  const ledger = new Ledger(actors())
  ledger.direct(effect(1, 10000, 2), 1000)
  expect(ledger.attributeHit(1, attribution(), 1000)).toBe(true)
  ledger.direct(effect(2, 5000, 1), 2000)
  const rows = ledger.summary(1000, 3000, false, 2000)
  const [a, b] = [1, 2].map((id) => rows.find((row) => row.actor.id === id)!)
  expect(b.skills['action:10'].contribution).toBe(9400)
  expect(a.skills['status:786']).toMatchObject({ damage: 0, healing: 0, hits: 0, contribution: 600 })
  expect(a.skills['action:10'].contribution).toBe(5000)
  // What the players kept and gave is their damage
  expect(a.contribution! + b.contribution!).toBe(15000)
  for (const row of rows) {
    expect(row.contribution).toBe(Object.values(row.skills).reduce((sum, skill) => sum + skill.contribution!, 0))
    // Over the duration of encDps
    expect(row.metrics.contributionDps).toEqual({
      value: row.contribution! / 2,
      quality: 'estimated',
      reason: '按团辅效果估算拆分',
    })
    expect(row.metrics.encDps.value).toBe(row.totals.damage / 2)
  }
  expect(a.skills['status:786'].contributionDps.value).toBe(300)
  // Splits come right after their effect; a later effect leaves nothing to match
  expect(ledger.attributeHit(1, attribution(), 1000)).toBe(false)
  expect(ledger.diagnostics.unmatchedAttributions).toBe(1)
})
it('takes the split of a pet hit from the pet, which merges into its owner', () => {
  const ledger = new Ledger(actors())
  ledger.direct(effect(1, 1000, 3), 1000)
  ledger.attributeHit(
    1,
    attribution({
      attackerId: 1,
      actorId: 3,
      amount: 1000,
      contributions: [{ statusId: 786, sourceId: 2, amount: 50 }],
    }),
    1000,
  )
  ledger.direct(effect(2, 2000, 1), 1000)
  const separate = ledger.summary(1000, 2000, false, 1000)
  expect(separate.find((row) => row.actor.id === 3)!.contribution).toBe(950)
  const owner = ledger.summary(1000, 2000, true, 1000).find((row) => row.actor.id === 1)!
  expect(owner.contribution).toBe(2950)
  expect(owner.skills['action:10'].contribution).toBe(2950)
})
it('takes the parts of providers outside the scope from the attacker, and counts them apart', () => {
  const ledger = new Ledger(actors())
  ledger.direct(effect(1, 10000, 2), 1000)
  ledger.attributeHit(1, attribution({ contributions: [{ statusId: 786, sourceId: 10, amount: 600 }] }), 1000)
  expect(ledger.rows.get('source:1:2')!.contribution).toBe(9400)
  expect(ledger.rows.has('source:1:10')).toBe(false)
  expect(ledger.diagnostics.outOfScopeContribution).toBe(600)
})
it('leaves a split that matches no hit of the effect uncounted', () => {
  const ledger = new Ledger(actors())
  ledger.direct(effect(1, 10000, 2), 1000)
  expect(ledger.attributeHit(1, attribution({ amount: 9999 }), 1000)).toBe(false)
  expect(ledger.attributeHit(1, attribution({ targetId: 1 }), 1000)).toBe(false)
  expect(ledger.attributeHit(2, attribution(), 1000)).toBe(false)
  expect(ledger.diagnostics.unmatchedAttributions).toBe(3)
  expect(ledger.rows.get('source:1:2')!.contribution).toBe(10000)
  expect(ledger.rows.has('source:1:1')).toBe(false)
})
it('gives no contributionDps without the splits of the host, nor for rows saved before them', () => {
  const ledger = new Ledger(actors())
  ledger.direct(effect(1, 10000, 2), 1000)
  ledger.contributionUnavailable = '周期模型不可用，无法计算 rDPS'
  const [row] = ledger.summary(1000, 2000, false, 1000)
  for (const metric of [row.metrics.contributionDps, row.skills['action:10'].contributionDps])
    expect(metric).toEqual({ value: null, quality: 'unavailable', reason: '周期模型不可用，无法计算 rDPS' })

  const restored = new Ledger(actors())
  const { contribution: _, ...old } = row
  restored.restore({ ...old, skills: { 'action:10': { ...row.skills['action:10'], contribution: undefined } } })
  const [again] = restored.summary(1000, 2000, false, 1000)
  expect(again.metrics.contributionDps).toEqual({
    value: null,
    quality: 'unavailable',
    reason: '这场战斗没有 rDPS 数据',
  })
  expect(again.skills['action:10'].contributionDps.reason).toBe('这场战斗没有 rDPS 数据')
})
it('counts critical and direct hits per skill, sums them into the actor and merges pets into the owner', () => {
  const ledger = new Ledger(actors())
  const hit = (seq: number, source: number, actionId: number, critical: boolean, direct: boolean) => {
    const event = effect(seq, 100, source)
    event.data.actionId = actionId
    Object.assign(event.data.targets[0].effects[0], { critical, direct })
    return event
  }
  ledger.direct(hit(1, 1, 10, true, false), 1000)
  ledger.direct(hit(2, 1, 10, true, true), 1100)
  ledger.direct(hit(3, 1, 11, false, true), 1200)
  ledger.direct(effect(4, 0, 1, 9, 1), 1300)
  ledger.direct(hit(5, 3, 12, true, true), 1400)
  ledger.periodic(tick({ occurredAt: 1500 }))
  const [owner, pet] = ledger.summary(1000, 2000, false)
  expect(owner.skills['action:10']).toMatchObject({ hits: 2, directHits: 2, crit: 2, direct: 1, critDirect: 1 })
  expect(owner.skills['action:11']).toMatchObject({ hits: 1, directHits: 1, crit: 0, direct: 1, critDirect: 0 })
  // Periodic damage has no critical or direct-hit flags and is not a direct hit.
  expect(owner.skills['status:1']).toMatchObject({ hits: 1, directHits: 0, crit: 0 })
  for (const row of [owner, pet])
    for (const field of ['crit', 'direct', 'critDirect'] as const)
      expect(Object.values(row.skills).reduce((sum, skill) => sum + skill[field], 0)).toBe(row.totals[field])
  const [merged] = ledger.summary(1000, 2000, true)
  expect(merged.skills['action:12']).toMatchObject({ directHits: 1, crit: 1, direct: 1, critDirect: 1 })
  expect(merged.skills['action:10']).toEqual(owner.skills['action:10'])
})

it('counts the damage, damage taken and death of an NPC party member in its own row', () => {
  const ledger = new Ledger(npcParty())
  ledger.direct(effect(1, 100, 4, 9), 1000)
  ledger.direct(effect(2, 30, 9, 4), 2000)
  ledger.direct(
    { type: 'actorDied', packet: sample(effect(3), 3000).value.packet, data: { actorId: 4, causedByActorId: 9 } },
    3000,
  )
  const rows = ledger.summary(1000, 3000, true)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ actor: { key: 'source:0:4', name: '亲信', kind: 'member' } })
  expect(rows[0].totals).toMatchObject({ damage: 100, taken: 30, deaths: 1 })
  expect(ledger.diagnostics.outOfScopeDamage).toBe(0)
})
