import { expect, it } from 'vitest'
import { Encounters } from '../encounters.js'
import { actors, effect, sample, tick } from '../fixtures.js'
import { metric, REFLECT_SKILL, type RowSummary, type Summary } from '../model.js'
import { damageCells, damageRows, damageSkills, healerCells, healerRows, healSkills, totalCells } from './tables.js'

/** A fight of the fixture actors: 1 (PLD) hits twice, 2 (WHM) hits and heals, the pet of 1 hits, a DoT ticks. */
function fight(): Summary {
  const encounters = new Encounters(
    () => 'battle',
    () => {},
  )
  encounters.updateActors(actors())
  encounters.localActorId = 1
  const crit = effect(1, 1_500_000)
  crit.data.targets[0].effects[0].critical = true
  encounters.accept(sample(crit, 1000), 1000)
  encounters.accept(sample(effect(2, 500_000), 2000), 2000)
  encounters.accept(sample(effect(3, 300, 2), 2500), 2500)
  encounters.accept(sample(effect(4, 2000, 2, 1, 4), 2600), 2600)
  encounters.accept(sample(effect(5, 100, 3), 2700), 2700)
  encounters.accept(sample({ type: 'periodicTick', data: tick({ occurredAt: 3000 }) }, 3000), 3000)
  encounters.end('battle', 4000)
  return encounters.snapshot(encounters.completed[0], false)!
}
const texts = (cells: { text: string }[]) => cells.map((cell) => cell.text)
const row = (summary: Summary, id: number) => summary.rows.find((item) => item.actor.id === id)!

it('orders the damage table by DPS and formats amounts, rates and missing values', () => {
  const summary = fight()
  expect(summary.durationMs).toBe(2000)
  expect(damageRows(summary).map((item) => item.actor.id)).toEqual([1, 2, 3])
  // No buffs in the fight: the rDPS of each actor is its DPS.
  expect(texts(damageCells(row(summary, 1), summary))).toEqual(['1.0M', '1.0M', '33.3%', '0.0%', '0.0%', '0', '0'])
  expect(texts(damageCells(row(summary, 3), summary)).slice(0, 2)).toEqual(['50', '50'])
})
it('sums the total row and shows no rDPS when a row lacks it', () => {
  const summary = fight()
  const known = summary.rows.map(
    (item): RowSummary => ({
      ...item,
      metrics: { ...item.metrics, contributionDps: metric(1000) },
      totals: { ...item.totals, taken: 600_000, deaths: 1 },
    }),
  )
  expect(texts(totalCells(known.slice(1), summary))).toEqual(['200', '2,000', '', '', '', '1.2M', '2'])
  known[2].metrics.contributionDps = { value: null, quality: 'unavailable' }
  const unavailable = { ...summary, contributionUnavailable: '周期模型不可用，无法计算 rDPS' }
  const total = totalCells(known, unavailable)
  expect(texts(total).slice(0, 2)).toEqual(['1.0M', '—'])
  expect(total[1].title).toBe('周期模型不可用，无法计算 rDPS')
  const cell = damageCells(known[2], unavailable)[1]
  expect(cell).toEqual({ text: '—', title: '周期模型不可用，无法计算 rDPS' })
  // The metric's own reason comes first.
  known[2].metrics.contributionDps = metric(null, 'unavailable', '这场战斗没有 rDPS 数据')
  expect(damageCells(known[2], unavailable)[1].title).toBe('这场战斗没有 rDPS 数据')
})
it('lists the damaging skills with their DPS over the fight and no rates for damage over time', () => {
  const summary = fight()
  const lines = damageSkills(row(summary, 1), summary)
  expect(lines.map((line) => line.key)).toEqual(['action:10', 'status:1'])
  expect(texts(lines[0].cells)).toEqual(['1.0M', '1.0M', '50.0%', '0.0%', '0.0%', '', ''])
  expect(texts(lines[1].cells)).toEqual(['25', '25', '—', '—', '—', '', ''])
  expect(lines[1].cells[2].title).toBe('持续伤害没有暴击和直击标记')
  // A healing-only skill is not a damage line.
  expect(damageSkills(row(summary, 2), summary).map((line) => line.key)).toEqual(['action:10'])
})
it('lists a skill with rDPS but no damage, and a direct skill without direct hits shows no rates', () => {
  const summary = fight()
  const owner = row(summary, 1)
  owner.skills['status:1000'] = { ...owner.skills['status:1'], damage: 0, contributionDps: metric(120) }
  owner.skills['action:20'] = { ...owner.skills['action:10'], damage: 10, directHits: 0, crit: 0 }
  const lines = damageSkills(owner, summary)
  expect(lines.map((line) => line.key)).toEqual(['action:10', 'status:1', 'action:20', 'status:1000'])
  expect(texts(lines[2].cells).slice(2, 5)).toEqual(['—', '—', '—'])
  expect(texts(lines[3].cells).slice(0, 2)).toEqual(['0', '120'])
})
it('shows no rates for reflected damage', () => {
  const summary = fight()
  const owner = row(summary, 1)
  owner.skills[REFLECT_SKILL] = { ...owner.skills['action:10'], damage: 433, hits: 0, directHits: 0, crit: 0 }
  const line = damageSkills(owner, summary).find((item) => item.key === REFLECT_SKILL)!
  expect(texts(line.cells).slice(2, 5)).toEqual(['—', '—', '—'])
  expect(line.cells[2].title).toBe('反伤没有暴击和直击标记')
})
it('lists only healers, with HPS and overheal of the actor and of each healing skill', () => {
  const summary = fight()
  expect(healerRows(summary).map((item) => item.actor.id)).toEqual([2])
  const healer = row(summary, 2)
  healer.metrics.overheal = metric(null, 'unavailable', '治疗生效时没有目标 HP')
  expect(texts(healerCells(healer))).toEqual(['1,000', '—'])
  expect(healerCells(healer)[1].title).toBe('治疗生效时没有目标 HP')
  healer.metrics.overheal = metric(500, 'estimated', '按治疗生效前收到的目标 HP 推算')
  expect(texts(healerCells(healer))).toEqual(['1,000', '25.0%'])
  healer.skills['action:10'].overheal = metric(1000)
  expect(healSkills(healer, summary).map((line) => [line.key, ...texts(line.cells)])).toEqual([
    ['action:10', '1,000', '50.0%'],
  ])
  expect(texts(healerCells({ ...healer, totals: { ...healer.totals, healing: 0 } }))[1]).toBe('—')
  expect(healerRows({ ...summary, rows: summary.rows.filter((item) => item.actor.id !== 2) })).toEqual([])
})
