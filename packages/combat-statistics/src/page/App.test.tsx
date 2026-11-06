// @vitest-environment jsdom
import type { Value } from '@ffcafe/mojito-plugin-sdk'
import type { ViewBridge } from '@ffcafe/mojito-plugin-sdk/view'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { StatisticsState, VisitsState, VisitView } from '../view-model.js'
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

function show(visits: VisitsState) {
  const channels: Record<string, unknown> = { statistics, visits }
  const view = {
    subscribe: (channel: string, listener: (batch: { items: Value[] }) => void) => {
      listener({ items: [channels[channel] as Value] })
      return { dispose() {} }
    },
  } as unknown as ViewBridge
  return render(
    <Bridge.Provider value={{ view, command: async () => null }}>
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
