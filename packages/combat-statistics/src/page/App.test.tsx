// @vitest-environment jsdom
import type { Value } from '@ffcafe/mojito-plugin-sdk'
import type { ViewBridge } from '@ffcafe/mojito-plugin-sdk/view'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { FightEntry } from '../log/types.js'
import type { Command, StatisticsState, VisitsState, VisitView } from '../view-model.js'
import { DEFAULT_QUERY } from '../visit-filter.js'
import { App } from './App.js'
import { Bridge } from './bridge.js'

afterEach(cleanup)

const statistics = {
  current: null,
  activeFightId: null,
  following: true,
  selection: null,
  selected: null,
  loading: false,
  loadError: null,
  names: {},
  inputError: null,
  paused: false,
  inCombat: null,
} as unknown as StatisticsState
const visit = (id: number): VisitView => ({
  id: `visit-${id}`,
  territoryType: 1001,
  zoneName: `副本${id}`,
  enteredAt: 0,
  leftAt: 1,
  current: false,
  status: 'ok',
  error: null,
  fights: [],
})
const first: VisitsState = {
  visits: [visit(1)],
  query: DEFAULT_QUERY,
  page: 0,
  hasPrevious: false,
  hasNext: false,
  reading: false,
  selected: null,
}

function show(visits: VisitsState | null, sent: Command[] = []) {
  const channels: Record<string, unknown> = { statistics, visits }
  const view = {
    subscribe: (channel: string, listener: (batch: { items: Value[] }) => void) => {
      if (channels[channel]) listener({ items: [channels[channel] as Value] })
      return { dispose() {} }
    },
  } as unknown as ViewBridge
  return render(
    <Bridge.Provider
      value={{
        view,
        command: async (input: Command) => {
          sent.push(input)
          return null
        },
      }}
    >
      <App />
    </Bridge.Provider>,
  )
}

it('titles the list 最近进本 without conditions and 搜索结果 with one', () => {
  show(first)
  expect(screen.getByRole('navigation', { name: '最近进本' })).not.toBeNull()
  cleanup()
  show({ ...first, visits: [], query: { ...DEFAULT_QUERY, character: 'Alice' } })
  expect(screen.getByRole('navigation', { name: '搜索结果' })).not.toBeNull()
  expect(screen.getByText('没有符合条件的进本')).not.toBeNull()
})
it('has no page buttons with a single page', () => {
  show(first)
  expect(screen.queryByText('上一页')).toBeNull()
  expect(screen.queryByText('下一页')).toBeNull()
})
it('disables 上一页 on the first page', () => {
  show({ ...first, hasNext: true })
  expect((screen.getByText('上一页') as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByText('下一页') as HTMLButtonElement).disabled).toBe(false)
})
it('tells while older files are read, and shows no empty result meanwhile', () => {
  show({ ...first, visits: [], query: { ...DEFAULT_QUERY, duty: 'x' }, reading: true })
  expect(screen.getByText('正在读取更早的日志')).not.toBeNull()
  expect(screen.queryByText('没有符合条件的进本')).toBeNull()
})

const entry = (number: number, changes: Partial<FightEntry>): FightEntry => ({
  number,
  id: `fight-${number}`,
  startAt: 0,
  endAt: 1,
  reason: 'outOfCombat',
  scope: 'party',
  durationMs: 582_000,
  deaths: 4,
  result: 'kill',
  mainEnemy: null,
  truncated: false,
  hashed: true,
  ...changes,
})
it('shows the HP left on a wipe and the deaths on a kill', () => {
  const enemy = { name: '敌人', hpCur: 34, hpMax: 1000, hpPercent: 3.4 }
  const fights = [entry(1, { result: 'wipe', deaths: 8, mainEnemy: enemy }), entry(2, { mainEnemy: enemy })]
  show({ ...first, visits: [{ ...visit(1), fights }] })
  fireEvent.click(screen.getByText('副本1'))
  const metas = [...document.querySelectorAll('.fight-meta')].map((meta) => meta.textContent)
  // The latest fight first
  expect(metas).toEqual(['9:42 · 死亡 4', '9:42 · 剩余 3.4%'])
  expect(screen.getByText('副本1').getAttribute('title')).toBe('副本1')
})
it('clears the conditions from the title of the results', () => {
  const sent: Command[] = []
  show({ ...first, query: { ...DEFAULT_QUERY, character: 'Alice' } }, sent)
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
  expect(sent).toEqual([{ kind: 'visits', query: DEFAULT_QUERY, page: 0 }])
  cleanup()
  show(first)
  expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull()
})
it('shows only the empty state when nothing is logged', () => {
  const h = show({ ...first, visits: [] })
  expect(screen.queryByText('筛选和搜索')).toBeNull()
  expect(screen.queryByText('最近进本')).toBeNull()
  expect(h.container.querySelector('.layout.blank')).not.toBeNull()
  expect(screen.getByText('还没有战斗记录')).not.toBeNull()
  cleanup()
  show({ ...first, visits: [], query: { ...DEFAULT_QUERY, duty: 'x' } })
  expect(screen.getByText('筛选和搜索')).not.toBeNull()
  expect(screen.getByText('没有符合条件的进本')).not.toBeNull()
  cleanup()
  show(null)
  expect(screen.getByText('筛选和搜索')).not.toBeNull()
})
