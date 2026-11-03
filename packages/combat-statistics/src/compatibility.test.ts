import { expect, it } from 'vitest'
import { compatibility } from './compatibility.js'
import { Encounters } from './encounters.js'
import { actors, effect, npcParty, sample } from './fixtures.js'

it('formats the numeric aliases consumed by original templates without turning unavailable rates into zero', () => {
  const encounters = new Encounters(
    () => 'fixture',
    () => {},
  )
  encounters.updateActors(actors())
  const hit = effect(1, 100)
  hit.data.targets[0].effects[0].critical = true
  hit.data.targets[0].effects[0].direct = true
  encounters.accept(sample(hit, 1000), 1000)
  const first = compatibility(encounters.snapshot(), { id: 1, name: 'Example' }, null, 'en', null)
  expect(first.combatData?.Encounter).not.toHaveProperty('ENCDPS')
  expect(first.combatData?.Combatant.YOU).toMatchObject({
    MAXHIT: '100',
    maxhit: '#10-100',
    CritDirectHitPct: '100.00%',
  })
  encounters.accept(sample(effect(2, 200), 2000), 2000)
  const next = compatibility(encounters.snapshot(), { id: 1, name: 'Example' }, null, 'en', null)
  expect(next.combatData?.Encounter).toMatchObject({ damage: '300', hits: '2', ENCDPS: '300', ENCHPS: '0' })
  expect(next.combatData?.Combatant.YOU).toMatchObject({ ENCDPS: '300', MAXHIT: '200', CritDirectHitPct: '50.00%' })
  expect(next.inCombat).toBeNull()
})

it('resolves Chinese names while preserving unavailable-name fallbacks', () => {
  const encounters = new Encounters(
    () => 'names',
    () => {},
  )
  encounters.updateActors(actors())
  encounters.accept(sample(effect(1), 1000), 1000)
  const state = compatibility(encounters.snapshot(), null, { id: 339, name: '海雾村' }, 'chs', false, {
    actions: new Map([[10, '全金属爆发']]),
  })
  expect(state.language).toBe('cn')
  expect(state.combatData?.Encounter).toMatchObject({ title: '目标', CurrentZoneName: '海雾村' })
  expect(Object.values(state.combatData!.Combatant)[0].maxhit).toBe('全金属爆发-100')
})

it.each([
  [0, '00:00'],
  [9, '00:09'],
  [59, '00:59'],
  [60, '01:00'],
  [74, '01:14'],
  [74.999, '01:14'],
  [599, '09:59'],
  [600, '10:00'],
  [3599, '59:59'],
  [3600, '60:00'],
  [6000, '100:00'],
])('pads duration at %s seconds without changing numeric fields', (seconds, expected) => {
  const encounters = new Encounters(
    () => 'duration',
    () => {},
  )
  encounters.config.mode = 'manual'
  encounters.updateActors(actors())
  encounters.accept(sample(effect(1, 100), 1000), 1000)
  encounters.accept(sample(effect(2, 200), 1000 + Number(seconds) * 1000), 1000 + Number(seconds) * 1000)
  const summary = encounters.snapshot()!
  const before = structuredClone(summary)
  const state = compatibility(summary, { id: 1, name: 'Example' }, null, 'en', false)
  expect(state.combatData?.Encounter).toMatchObject({ duration: expected, DURATION: String(seconds), damage: '300' })
  expect(state.combatData?.Combatant.YOU).toMatchObject({
    duration: expected,
    DURATION: String(seconds),
    damage: '300',
  })
  if (Number(seconds) > 0) {
    expect(state.combatData?.Encounter.encdps).toBe((300 / Number(seconds)).toFixed(2))
    expect(state.combatData?.Combatant.YOU.encdps).toBe((300 / Number(seconds)).toFixed(2))
  } else expect(state.combatData?.Encounter).not.toHaveProperty('encdps')
  expect(summary).toEqual(before)
})

it('keeps fractional durations and formats a late participant using their own clock', () => {
  const encounters = new Encounters(
    () => 'precise',
    () => {},
  )
  encounters.config.mode = 'manual'
  encounters.updateActors(actors())
  encounters.accept(sample(effect(1, 100, 2), 1000), 1000)
  encounters.accept(sample(effect(2, 100), 61000), 61000)
  const last = sample(effect(3, 200), 66331)
  last.meta.observedAt = 68000
  encounters.accept(last, 68000)
  const state = compatibility(encounters.snapshot(), { id: 1, name: 'Example' }, null, 'en', false)
  expect(state.combatData?.Encounter).toMatchObject({ duration: '01:05', DURATION: '65.331' })
  expect(state.combatData?.Combatant.YOU).toMatchObject({
    duration: '00:05',
    DURATION: '5.331',
    dps: (300 / 5.331).toFixed(2),
    encdps: (300 / 65.331).toFixed(2),
    ENCDPS: (300 / 65.331).toFixed(0),
  })
})

it('reports the overheal percentage only when overheal is known', () => {
  const encounters = new Encounters(
    () => 'overheal',
    () => {},
  )
  encounters.updateActors(actors())
  const hp = (seq: number, hpCur: number, sequence: number) => ({
    type: 'hpChanged' as const,
    packet: { seq, timestamp: seq, sourceActorId: 1, targetActorId: 1 },
    data: { origin: 'effectResult' as const, actorId: 1, hpCur, hpMax: 10000, sequence },
  })
  const heal = (seq: number, sequence: number) => {
    const event = effect(seq, 1000, 1, 1, 4)
    event.data.sequence = sequence
    return event
  }
  encounters.accept(sample(effect(1), 1000), 1000)
  const player = { id: 1, name: 'Example' }
  expect(compatibility(encounters.snapshot(), player, null, 'en', null).combatData?.Combatant.YOU).not.toHaveProperty(
    'OverHealPct',
  )
  encounters.accept(sample(heal(2, 7), 1100), 1100)
  encounters.accept(sample(hp(3, 10000, 7), 1200), 1200)
  expect(compatibility(encounters.snapshot(), player, null, 'en', null).combatData?.Combatant.YOU).not.toHaveProperty(
    'OverHealPct',
  )
  encounters.accept(sample(heal(4, 8), 1300), 1300)
  encounters.accept(sample(hp(5, 10000, 8), 1400), 1400)
  encounters.accept(sample(hp(6, 9250, 9), 1500), 1500)
  encounters.accept(sample(heal(7, 9), 1600), 1600)
  encounters.accept(sample(hp(8, 10000, 9), 1700), 1700)
  const state = compatibility(encounters.snapshot(), player, null, 'en', null)
  // 1000 unmeasured, 1000 fully overhealed and 1000 of which 250 overhealed
  expect(state.combatData?.Combatant.YOU.OverHealPct).toBe('41.67%')
  expect(state.availability.combatData.reason).toContain('盾与贡献 DPS 不可用')
  expect(state.availability.combatData.reason).not.toContain('有效治疗')
})

it('shows only the character name while keeping same-named actors from different worlds apart', () => {
  const encounters = new Encounters(
    () => 'names',
    () => {},
  )
  encounters.updateActors(actors())
  encounters.accept(sample(effect(1, 100, 1), 1000), 1000)
  encounters.accept(sample(effect(2, 200, 2), 2000), 2000)
  const rows = Object.entries(compatibility(encounters.snapshot(), null, null, 'en', null).combatData!.Combatant)
  expect(rows).toHaveLength(2)
  expect(new Set(rows.map(([key]) => key)).size).toBe(2)
  expect(rows.map(([, fields]) => [fields.name, fields.damage]).sort()).toEqual([
    ['同名', '100'],
    ['同名', '200'],
  ])
  const own = compatibility(encounters.snapshot(), { id: 1, name: 'Example' }, null, 'en', null).combatData!.Combatant
  expect(own.YOU).toMatchObject({ name: 'YOU', damage: '100' })
  expect(Object.values(own).find((fields) => fields.damage === '200')?.name).toBe('同名')
  const unnamed = actors()
  unnamed.set(2, { ...unnamed.get(2)!, name: null })
  encounters.updateActors(unnamed)
  const fallback = compatibility(encounters.snapshot(), null, null, 'en', null).combatData!.Combatant
  expect(Object.values(fallback).find((fields) => fields.damage === '200')?.name).toBe('Actor 2')
})

it('lists an NPC party member like a player, with an empty job when the game gives none', () => {
  const encounters = new Encounters(
    () => 'npc',
    () => {},
  )
  encounters.updateActors(npcParty())
  encounters.accept(sample(effect(1, 100), 1000), 1000)
  encounters.accept(sample(effect(2, 300, 4, 9), 2000), 2000)
  const state = compatibility(encounters.snapshot(), { id: 1, name: '玩家' }, null, 'cn', null)
  const rows = Object.values(state.combatData!.Combatant)
  expect(rows.map((fields) => fields.name).sort()).toEqual(['YOU', '亲信'])
  expect(rows.find((fields) => fields.name === '亲信')).toMatchObject({ Job: '', damage: '300' })
})
