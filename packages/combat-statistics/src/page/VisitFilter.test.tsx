// @vitest-environment jsdom
import type { Value } from '@ffcafe/mojito-plugin-sdk'
import type { ViewBridge } from '@ffcafe/mojito-plugin-sdk/view'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { Command } from '../view-model.js'
import { DEFAULT_QUERY, type VisitQuery } from '../visit-filter.js'
import { Bridge } from './bridge.js'
import { querySummary, VisitFilter } from './VisitFilter.js'

afterEach(cleanup)

function setup(query: VisitQuery = DEFAULT_QUERY) {
  const sent: Command[] = []
  const command = async (input: Command): Promise<Value> => {
    if (input.kind === 'visits') sent.push(input)
    return null
  }
  const tree = (current: VisitQuery) => (
    <Bridge.Provider value={{ view: {} as ViewBridge, command }}>
      <VisitFilter query={current} />
    </Bridge.Provider>
  )
  const result = render(tree(query))
  const head = () => result.container.querySelector('summary')!
  return { ...result, sent, head, rerenderWith: (next: VisitQuery) => result.rerender(tree(next)) }
}

it('is a closed <details> with the conditions in effect beside its title', () => {
  const h = setup()
  const details = h.head().parentElement as HTMLDetailsElement
  expect(details.tagName).toBe('DETAILS')
  expect(details.open).toBe(false)
  expect(h.head().textContent).toBe('筛选和搜索未筛选')
})
it('applies the conditions on 搜索 or Enter only', () => {
  const h = setup()
  fireEvent.change(screen.getByLabelText('副本名'), { target: { value: '歼灭战' } })
  fireEvent.change(screen.getByLabelText('角色名'), { target: { value: 'Alice' } })
  expect(h.sent).toEqual([])
  fireEvent.click(screen.getByText('搜索'))
  const query = { ...DEFAULT_QUERY, duty: '歼灭战', character: 'Alice' }
  expect(h.sent).toEqual([{ kind: 'visits', query, page: 0 }])
  fireEvent.keyDown(screen.getByLabelText('角色名'), { key: 'Enter' })
  expect(h.sent).toHaveLength(2)
  expect(h.sent[1]).toEqual({ kind: 'visits', query, page: 0 })
})
it('resets to the default query at once', () => {
  const h = setup({ ...DEFAULT_QUERY, duty: 'a' })
  fireEvent.click(screen.getByText('重置'))
  expect(h.sent).toEqual([{ kind: 'visits', query: DEFAULT_QUERY, page: 0 }])
  expect((screen.getByLabelText('副本名') as HTMLInputElement).value).toBe('')
})
it('sums up the jobs with / for the own job and with + for the party', () => {
  const h = setup()
  fireEvent.click(screen.getByRole('button', { name: '骑士', hidden: true }))
  fireEvent.click(screen.getByRole('button', { name: '白魔法师', hidden: true }))
  expect(screen.getByRole('button', { name: '骑士', hidden: true }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByText('自己的职业是所选之一')).not.toBeNull()
  fireEvent.click(screen.getByText('搜索'))
  h.rerenderWith(h.sent[0].kind === 'visits' ? h.sent[0].query : DEFAULT_QUERY)
  expect(h.head().textContent).toContain('自己：骑士/白魔法师')
  fireEvent.click(screen.getByLabelText('仅自己'))
  fireEvent.click(screen.getByText('搜索'))
  h.rerenderWith(h.sent[1].kind === 'visits' ? h.sent[1].query : DEFAULT_QUERY)
  expect(h.head().textContent).toContain('队伍：骑士+白魔法师')
})
it('opens the job picker as a popover of its button', () => {
  const h = setup()
  // Closed until its button opens it; the browser places it and closes it on Esc or a click outside
  const picker = h.container.querySelector('[popover]')!
  expect(picker.getAttribute('popover')).toBe('auto')
  expect(picker.getAttribute('aria-label')).toBe('选择职业')
  expect(screen.getByText('职业：全部').getAttribute('popovertarget')).toBe(picker.id)
})
it('applies the dates on 搜索 or Enter', () => {
  const h = setup()
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } })
  fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-07' } })
  fireEvent.click(screen.getByText('搜索'))
  const query = { ...DEFAULT_QUERY, from: '2026-10-01', to: '2026-10-07' }
  expect(h.sent).toEqual([{ kind: 'visits', query, page: 0 }])
  fireEvent.keyDown(screen.getByLabelText('结束日期'), { key: 'Enter' })
  expect(h.sent[1]).toEqual({ kind: 'visits', query, page: 0 })
})
it('sends a cleared date as null, and clears both dates on 重置', () => {
  const h = setup({ ...DEFAULT_QUERY, from: '2026-10-01', to: '2026-10-07' })
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '' } })
  fireEvent.click(screen.getByText('搜索'))
  expect(h.sent[0]).toEqual({ kind: 'visits', query: { ...DEFAULT_QUERY, to: '2026-10-07' }, page: 0 })
  fireEvent.click(screen.getByText('重置'))
  expect(h.sent[1]).toEqual({ kind: 'visits', query: DEFAULT_QUERY, page: 0 })
  expect((screen.getByLabelText('开始日期') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('结束日期') as HTMLInputElement).value).toBe('')
})
it('sums up the dates without the year when all of them are in this year', () => {
  const dates = (from: string | null, to: string | null) => querySummary({ ...DEFAULT_QUERY, from, to }, 2026)
  expect(dates('2026-10-01', '2026-10-07')).toBe('日期：10-01 至 10-07')
  expect(dates('2026-10-07', '2026-10-07')).toBe('日期：10-07')
  expect(dates('2026-10-01', null)).toBe('日期：10-01 起')
  expect(dates(null, '2026-10-07')).toBe('日期：至 10-07')
  expect(dates('2025-12-28', '2026-01-03')).toBe('日期：2025-12-28 至 2026-01-03')
  expect(dates('2025-12-28', null)).toBe('日期：2025-12-28 起')
})
it('sums up the dates between the character and the jobs', () => {
  expect(
    querySummary({ duty: 'a', character: 'b', from: '2026-10-01', to: null, jobs: [19], selfOnly: true }, 2026),
  ).toBe('副本：a · 角色：b · 日期：10-01 起 · 自己：骑士')
})
it('shows the whole summary on hover', () => {
  const h = setup({ ...DEFAULT_QUERY, duty: '歼灭战', from: '2026-10-01', to: '2026-10-07' })
  const summary = h.container.querySelector('.visit-filter-summary')!
  expect(summary.getAttribute('title')).toBe(summary.textContent)
})
