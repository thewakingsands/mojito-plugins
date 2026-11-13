// @vitest-environment jsdom
import type { ViewBridge } from '@ffcafe/mojito-plugin-sdk/view'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Encounters } from '../encounters.js'
import { actors, effect, sample } from '../fixtures.js'
import type { FightEntry } from '../log/types.js'
import { metric, type Summary } from '../model.js'
import type { StatisticsState, VisitView } from '../view-model.js'
import { Bridge } from './bridge.js'
import { Overview } from './Overview.js'

afterEach(cleanup)

function summary(): Summary {
  const encounters = new Encounters(
    () => 'battle',
    () => {},
  )
  encounters.updateActors(actors())
  encounters.localActorId = 1
  encounters.accept(sample(effect(1, 1_500_000), 1000), 1000)
  encounters.accept(sample(effect(2, 500_000, 2), 2000), 2000)
  encounters.end('battle', 4000)
  return encounters.snapshot(encounters.completed[0], false)!
}
const fight: FightEntry = {
  number: 3,
  id: 'fight-3',
  startAt: 0,
  endAt: 2000,
  reason: 'outOfCombat',
  scope: 'party',
  durationMs: 2000,
  deaths: 0,
  result: 'kill',
  mainEnemy: null,
  truncated: false,
  hashed: true,
}
const visit: VisitView = {
  id: 'visit-1',
  territoryType: 1001,
  zoneName: '副本',
  enteredAt: 0,
  leftAt: 1,
  current: false,
  status: 'ok',
  error: null,
  fights: [fight],
}

function show(selected: Summary, changes: Partial<StatisticsState> = {}) {
  const statistics = {
    current: null,
    activeFightId: null,
    following: false,
    selection: { visitId: visit.id, fightId: fight.id },
    selected: { ...selected, id: fight.id },
    loading: false,
    loadError: null,
    names: {},
    inputError: null,
    paused: false,
    inCombat: null,
    ...changes,
  } as unknown as StatisticsState
  return render(
    <Bridge.Provider value={{ view: {} as ViewBridge, command: async () => null }}>
      <Overview statistics={statistics} visit={visit} onCurrent={() => {}} onReview={() => {}} />
    </Bridge.Provider>,
  )
}

it('leaves out the rDPS column and tells why beside the title when no row has rDPS', () => {
  const base = summary()
  const reason = '周期模型不可用，无法计算 rDPS'
  const rows = base.rows.map((row) => ({
    ...row,
    metrics: { ...row.metrics, contributionDps: metric(null, 'unavailable') },
  }))
  const h = show({ ...base, rows, contributionUnavailable: reason })
  const damage = h.container.querySelector('table.damage')!
  expect([...damage.querySelectorAll('th')].map((th) => th.textContent)).not.toContain('rDPS')
  // Every row has as many cells as the header
  for (const tr of damage.querySelectorAll('tr')) expect(tr.children).toHaveLength(7)
  expect(screen.getByText(`rDPS 不可用：${reason}`)).not.toBeNull()
  expect(screen.queryByText('团队 rDPS')).toBeNull()
  expect(screen.getByText('团队 DPS')).not.toBeNull()
})
it('keeps the rDPS column and gives each cell the class of its column', () => {
  const h = show(summary())
  const damage = h.container.querySelector('table.damage')!
  expect([...damage.querySelectorAll('th')].map((th) => th.className)).toEqual([
    '',
    'col-amount',
    'col-amount col-rdps',
    'col-rate',
    'col-rate',
    'col-rate',
    'col-taken',
    'col-count',
  ])
  expect(damage.querySelector('tr.actor td:nth-child(7)')!.className).toBe('col-taken')
  expect(h.container.querySelector('col')).toBeNull()
  expect(screen.queryByText(/rDPS 不可用/)).toBeNull()
})
it('names the review 战斗回顾 and tells why it cannot open during the fight', () => {
  show(summary(), { activeFightId: fight.id, current: { ...summary(), outcome: { result: null, mainEnemy: null } } })
  const button = screen.getByRole('button', { name: '战斗回顾' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  expect(button.title).toBe('战斗结束后才能打开战斗回顾')
  expect(button.dataset.variant).toBe('primary')
})
