// @vitest-environment jsdom
import type { Value } from '@ffcafe/mojito-plugin-sdk'
import type { ViewBridge } from '@ffcafe/mojito-plugin-sdk/view'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { Command } from '../view-model.js'
import { DEFAULT_QUERY, type VisitQuery } from '../visit-filter.js'
import { Bridge } from './bridge.js'
import { VisitFilter } from './VisitFilter.js'

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
  const head = () => result.container.querySelector('.visit-filter-head')!
  return { ...result, sent, head, rerenderWith: (next: VisitQuery) => result.rerender(tree(next)) }
}

it('starts closed with the chevron before the title, and opens', () => {
  const h = setup()
  expect(h.head().getAttribute('aria-expanded')).toBe('false')
  // The host's chevron, which turns with aria-expanded
  expect(h.head().firstElementChild?.className).toBe('mojito-chevron')
  expect(h.head().textContent).toBe('筛选和搜索未筛选')
  fireEvent.click(h.head())
  expect(h.head().getAttribute('aria-expanded')).toBe('true')
  expect(h.head().textContent).toBe('筛选和搜索')
})
it('applies the conditions on 搜索 or Enter only', () => {
  const h = setup()
  fireEvent.click(h.head())
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
  fireEvent.click(h.head())
  fireEvent.click(screen.getByText('重置'))
  expect(h.sent).toEqual([{ kind: 'visits', query: DEFAULT_QUERY, page: 0 }])
  expect((screen.getByLabelText('副本名') as HTMLInputElement).value).toBe('')
})
it('sums up the jobs with / for the own job and with + for the party', () => {
  const h = setup()
  fireEvent.click(h.head())
  fireEvent.click(screen.getByText('职业：全部'))
  fireEvent.click(screen.getByRole('button', { name: '骑士' }))
  fireEvent.click(screen.getByRole('button', { name: '白魔法师' }))
  expect(screen.getByRole('button', { name: '骑士' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByText('自己的职业是所选之一')).not.toBeNull()
  fireEvent.click(screen.getByText('搜索'))
  h.rerenderWith(h.sent[0].kind === 'visits' ? h.sent[0].query : DEFAULT_QUERY)
  fireEvent.click(h.head())
  expect(h.head().textContent).toContain('自己：骑士/白魔法师')
  fireEvent.click(h.head())
  fireEvent.click(screen.getByLabelText('仅自己'))
  fireEvent.click(screen.getByText('搜索'))
  h.rerenderWith(h.sent[1].kind === 'visits' ? h.sent[1].query : DEFAULT_QUERY)
  fireEvent.click(h.head())
  expect(h.head().textContent).toContain('队伍：骑士+白魔法师')
})
it('closes the job picker on a click outside of it', () => {
  const h = setup()
  fireEvent.click(h.head())
  fireEvent.click(screen.getByText('职业：全部'))
  expect(screen.queryByRole('dialog')).not.toBeNull()
  fireEvent.pointerDown(screen.getByRole('dialog'))
  expect(screen.queryByRole('dialog')).not.toBeNull()
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
})
