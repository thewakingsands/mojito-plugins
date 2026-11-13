// @vitest-environment jsdom
import type { Value } from '@ffcafe/mojito-plugin-sdk'
import type { ViewBridge } from '@ffcafe/mojito-plugin-sdk/view'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaults, REFLECT_SKILL, type Summary } from '../../model.js'
import type { Command, PotencySample, ReplayEvent, StatisticsState } from '../../view-model.js'
import { Bridge } from '../bridge.js'
import { enemy, member, replayData, track } from './data.test-helper.js'
import { ReplayView } from './ReplayView.js'
import { clockText } from './timeline.js'

const hit = (t: number) => ({
  t,
  source: 3,
  sourceName: null,
  actionId: 600,
  name: '死刑',
  amount: 900,
  periodic: false,
})
const events: ReplayEvent[] = [
  { kind: 'bossIn', t: 0, actor: 3 },
  {
    kind: 'death',
    t: 20_000,
    actor: 0,
    killingBlow: hit(19_500),
    recentHits: [hit(19_500)],
    maxHp: 1000,
    statuses: [],
  },
  {
    kind: 'penalty',
    t: 30_000,
    actor: 1,
    statusId: 215,
    name: '伤害降低',
    durationMs: 30_000,
    stacks: null,
    cause: { source: 3, sourceName: null, actionId: 601, name: '扇形' },
  },
]
const data = replayData({
  fight: { visitId: 'v', fightId: 'f', durationMs: 60_000 },
  actors: [
    member(0, 19, '骑士', track([[0, 0, 0]])),
    member(1, 24, '白魔', track([[0, 5, 5]])),
    member(2, 23, '诗人', track([[0, -5, 5]])),
    enemy(3, true, track([[0, 0, -5]])),
  ],
  entries: [
    { t: 1000, actor: 0, other: 3, skill: 'action:9', field: 'damage', amount: 5000, hit: 1 },
    { t: 1000, actor: 1, other: 3, skill: 'action:119', field: 'damage', amount: 3000, hit: 1 },
    { t: 2000, actor: 0, other: 3, skill: 'action:600', field: 'taken', amount: 900 },
    { t: 3000, actor: 1, other: 0, skill: 'action:120', field: 'healing', amount: 2000 },
  ],
  statuses: [
    { actor: 0, statusId: 100, source: 1, from: 0, to: 10_000, stacks: null },
    { actor: 1, statusId: 215, source: 3, from: 30_000, to: 60_000, stacks: null },
  ],
  statusInfo: [
    { statusId: 100, name: '增益', category: 'buff', raidBuff: true },
    { statusId: 215, name: '伤害降低', category: 'debuff', raidBuff: false },
  ],
  casts: [
    { t: 10_000, actor: 3, durationMs: 4700, actionId: 7982, name: '大地摇动', cancelledAt: null },
    { t: 40_000, actor: 3, durationMs: 4700, actionId: 7982, name: '大地摇动', cancelledAt: 42_000 },
  ],
  events,
})
const summary = {
  id: 'f',
  durationMs: 60_000,
  startAt: 0,
  rows: [],
  contributionUnavailable: null,
  outcome: { result: 'kill', mainEnemy: null },
} as unknown as Summary
const statistics = { selected: summary, settings: defaults, names: {} } as unknown as StatisticsState

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function open(replay = data, icon = async (_key: string): Promise<Value> => null) {
  const command = async (input: Command): Promise<Value> =>
    input.kind === 'replay'
      ? ({ ok: true, data: replay } as unknown as Value)
      : input.kind === 'icon'
        ? icon(input.key)
        : null
  render(
    <Bridge.Provider value={{ view: {} as ViewBridge, command }}>
      <ReplayView visitId="v" fightId="f" statistics={statistics} visit={undefined} onBack={() => {}} />
    </Bridge.Provider>,
  )
  await screen.findByRole('tablist')
}
/** A press as the pointer makes it: down, then click */
const press = (element: Element) => {
  fireEvent.pointerDown(element)
  fireEvent.click(element)
}
const event = (title: string) =>
  within(document.querySelector<HTMLElement>('.events')!).getByText(title).closest('button')!
const tab = (name: string) => screen.getByRole('tab', { name })
/** The popover of the member filter; closed in jsdom, so what it holds counts as hidden */
const memberFilter = () => document.querySelector<HTMLElement>('.member-filter')!
/** The checkboxes of the member filter, in its order */
const memberBoxes = () => within(memberFilter()).getAllByRole<HTMLInputElement>('checkbox', { hidden: true })
const memberBox = (name: string) => screen.getByRole('checkbox', { hidden: true, name })
const only = (name: string) => screen.getByRole('button', { hidden: true, name: `只看${name}` })
/** 100 ms a pixel over the fight of 60 seconds, for the curves and the ruler */
function mockLaneRect() {
  const rect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains('curve') && !this.classList.contains('ruler')) return rect.call(this)
    return { ...rect.call(this), left: 0, width: 600 }
  })
}

const detail = () => screen.queryByRole('region', { name: '事件详情' })

it('expands the panel with one press of the expand button while an event is expanded', async () => {
  await open()
  press(event('死亡 · 骑士'))
  expect(detail()!.textContent).toContain('致命一击')
  press(screen.getByRole('button', { name: '详细数据' }))
  expect(detail()).toBeNull()
  expect(tab('伤害').getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('button', { name: '收起' })).toBeTruthy()
})

it('uses the segmented control and the tabs of the base styles', async () => {
  await open()
  const zoom = screen.getByRole('group', { name: '缩放' })
  expect(zoom.className).toBe('mojito-segmented')
  expect(within(zoom).getByRole('button', { name: '整场' }).getAttribute('aria-pressed')).toBe('true')
  expect(within(zoom).getByRole('button', { name: '30 秒' }).getAttribute('aria-pressed')).toBe('false')
  press(screen.getByRole('button', { name: '详细数据' }))
  expect(screen.getByRole('tablist').className).toBe('mojito-tabs')
  press(tab('治疗'))
  const groups = screen.getByRole('group', { name: '治疗分组' })
  expect(groups.className).toBe('mojito-segmented')
  expect(within(groups).getByRole('button', { name: '按角色' }).getAttribute('aria-pressed')).toBe('true')
  expect(document.querySelector('tr.actor .mojito-chevron')).toBeTruthy()
})

it('expands one event at a time under it in the list, and collapses it on a second press or Esc', async () => {
  await open()
  press(event('伤害降低 · 白魔'))
  expect(event('伤害降低 · 白魔').getAttribute('aria-expanded')).toBe('true')
  expect(event('死亡 · 骑士').getAttribute('aria-expanded')).toBe('false')
  press(event('死亡 · 骑士'))
  expect(event('死亡 · 骑士').getAttribute('aria-expanded')).toBe('true')
  expect(event('伤害降低 · 白魔').getAttribute('aria-expanded')).toBe('false')
  expect(screen.getAllByRole('region', { name: '事件详情' })).toHaveLength(1)
  expect(event('死亡 · 骑士').parentElement!.contains(detail())).toBe(true)
  expect(detail()!.textContent).toContain('致命一击')
  press(event('死亡 · 骑士'))
  expect(detail()).toBeNull()
  press(event('死亡 · 骑士'))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(detail()).toBeNull()
})

const bigHit: ReplayEvent = {
  kind: 'bigHit',
  t: 25_000,
  actor: 0,
  hit: hit(25_000),
  maxHp: 1000,
  statuses: [],
}

it('leaves the big hits out until their switch is on, and counts every type', async () => {
  await open({ ...data, events: [...events, bigHit] })
  const box = (name: RegExp) => screen.getByRole<HTMLInputElement>('checkbox', { name })
  expect(box(/^死亡/).checked).toBe(true)
  expect(box(/^大额伤害/).checked).toBe(false)
  expect(box(/^大额伤害/).parentElement!.textContent).toBe('大额伤害1')
  expect(screen.queryByText('大额伤害 · 骑士')).toBeNull()
  expect(document.querySelectorAll('.events .event-mark')).toHaveLength(3)
  fireEvent.click(box(/^大额伤害/))
  expect(event('大额伤害 · 骑士')).toBeTruthy()
  expect(document.querySelectorAll('.events .event-mark')).toHaveLength(4)
  for (const name of [/^死亡/, /^惩罚/, /^首领/, /^大额伤害/]) fireEvent.click(box(name))
  expect(screen.getByText('没有选中任何事件类型')).toBeTruthy()
})

it('expands the event of a mark in the list, from any tab of the panel', async () => {
  await open()
  press(screen.getByRole('button', { name: '详细数据' }))
  const mark = [...document.querySelectorAll<HTMLElement>('.events .event-mark')].find((item) =>
    item.title.includes('死亡 · 骑士'),
  )!
  press(mark)
  expect(tab('重要事件').getAttribute('aria-selected')).toBe('true')
  expect(event('死亡 · 骑士').getAttribute('aria-expanded')).toBe('true')
  press(mark)
  expect(event('死亡 · 骑士').getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('0:20.0 / 1:00.0')).toBeTruthy()
})

it('keeps the grouping and the open rows of each table to itself', async () => {
  await open()
  press(screen.getByRole('button', { name: '详细数据' }))
  const rows = () => [...document.querySelectorAll('tr.actor')]
  press(rows()[0])
  expect(rows()[0].getAttribute('aria-expanded')).toBe('true')
  press(tab('承伤'))
  press(screen.getByRole('button', { name: '按敌人技能' }))
  press(tab('治疗'))
  expect(screen.getByRole('button', { name: '按角色' }).getAttribute('aria-pressed')).toBe('true')
  expect(rows().every((row) => row.getAttribute('aria-expanded') === 'false')).toBe(true)
  press(tab('承伤'))
  expect(screen.getByRole('button', { name: '按敌人技能' }).getAttribute('aria-pressed')).toBe('true')
  press(tab('伤害'))
  expect(rows()[0].getAttribute('aria-expanded')).toBe('true')
})

it('takes every press while playing', async () => {
  await open()
  press(screen.getByRole('button', { name: '播放' }))
  act(() => vi.advanceTimersByTime(2000))
  expect(screen.getByText(/^0:02\.\d \/ 1:00\.0$/)).toBeTruthy()
  press(screen.getByRole('button', { name: '详细数据' }))
  expect(tab('伤害').getAttribute('aria-selected')).toBe('true')
  act(() => vi.advanceTimersByTime(500))
  press(tab('治疗'))
  expect(tab('治疗').getAttribute('aria-selected')).toBe('true')
  press(screen.getByRole('button', { name: '30 秒' }))
  expect(screen.getByRole('button', { name: '30 秒' }).getAttribute('aria-pressed')).toBe('true')
  act(() => vi.advanceTimersByTime(500))
  expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy()
  press(screen.getByRole('button', { name: '收起' }))
  press(event('死亡 · 骑士'))
  expect(event('死亡 · 骑士').getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('0:20.0 / 1:00.0')).toBeTruthy()
  expect(detail()).toBeTruthy()
})

it('starts buff and debuff groups closed, and opens them separately', async () => {
  await open()
  press(screen.getByRole('button', { name: '详细数据' }))
  press(tab('Buff'))
  const toggle = () => document.querySelector('.uptime-toggle')!
  expect(toggle().getAttribute('aria-expanded')).toBe('false')
  press(toggle())
  expect(toggle().getAttribute('aria-expanded')).toBe('true')
  expect(within(document.querySelector('.panel-body') as HTMLElement).getByText('增益')).toBeTruthy()
  press(tab('Debuff'))
  expect(toggle().getAttribute('aria-expanded')).toBe('false')
  press(tab('Buff'))
  expect(toggle().getAttribute('aria-expanded')).toBe('true')
})

it('names reflected damage in the skills of a member', async () => {
  await open(
    replayData({
      fight: { visitId: 'v', fightId: 'f', durationMs: 60_000 },
      actors: [member(0, 21, '战士'), enemy(1, true)],
      entries: [
        { t: 1000, actor: 0, other: 1, skill: 'action:31', field: 'damage', amount: 5000, hit: 1 },
        { t: 2000, actor: 0, other: 1, skill: REFLECT_SKILL, field: 'damage', amount: 433 },
      ],
    }),
  )
  press(screen.getByRole('button', { name: '详细数据' }))
  press(document.querySelector('tr.actor')!)
  expect(screen.getByText('反伤')).toBeTruthy()
})

it('names a summed tick in the damage taken by skill', async () => {
  await open(
    replayData({
      fight: { visitId: 'v', fightId: 'f', durationMs: 60_000 },
      actors: [member(0, 21, '战士'), enemy(1, true)],
      entries: [{ t: 1000, actor: 0, other: -1, skill: 'status:0', field: 'taken', amount: 800 }],
    }),
  )
  press(screen.getByRole('button', { name: '详细数据' }))
  press(tab('承伤'))
  press(screen.getByRole('button', { name: '按敌人技能' }))
  expect(screen.getByText('持续伤害')).toBeTruthy()
  expect(screen.queryByText('状态 #0')).toBeNull()
})

it('draws the members on the map at their positions as the time moves', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  try {
    await open(
      replayData({
        fight: { visitId: 'v', fightId: 'f', durationMs: 60_000 },
        actors: [
          member(0, 19, '骑士', track(Array.from({ length: 11 }, (_, i) => [i * 1000, i * 2, 0]))),
          enemy(1, true, track([[0, 0, -5]])),
        ],
      }),
    )
    const knight = () => document.querySelector<HTMLElement>('.map-member')!
    const before = { left: knight().style.left, top: knight().style.top }
    expect(before).not.toEqual({ left: '0px', top: '0px' })
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(knight().style.left).not.toBe(before.left)
  } finally {
    vi.restoreAllMocks()
  }
})

it('draws a pane for each place the members are at', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  const seconds = Array.from({ length: 11 }, (_, i) => i * 1000)
  try {
    await open(
      replayData({
        fight: { visitId: 'v', fightId: 'f', durationMs: 10_000 },
        actors: [
          member(0, 19, '骑士', track(seconds.map((t) => [t, 0, 0]))),
          member(1, 24, '白魔', track(seconds.map((t) => [t, t < 5000 ? 200 : 5, 0]))),
        ],
      }),
    )
    const panes = () => [...document.querySelectorAll('.map-pane')]
    expect(document.querySelector('.map-wrapper.split')).toBeTruthy()
    expect(panes().map((pane) => pane.querySelectorAll('.map-member').length)).toEqual([1, 1])
    for (let second = 0; second < 6; second++) fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(document.querySelector('.map-wrapper.split')).toBeNull()
    expect(panes().map((pane) => pane.querySelectorAll('.map-member').length)).toEqual([2])
  } finally {
    vi.restoreAllMocks()
  }
})

it('writes the main enemy in the corner of the map instead of under its mark', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  try {
    await open(
      replayData({
        fight: { visitId: 'v', fightId: 'f', durationMs: 60_000 },
        actors: [
          member(0, 19, '骑士', track([[0, 0, 0]])),
          enemy(1, true, track([[0, 0, -5, 0, 0.5]])),
          enemy(2, false, track([[0, 5, -5]])),
        ],
      }),
    )
    const line = document.querySelector('.boss-line')!
    expect(line.textContent).toContain('敌人1')
    expect(line.textContent).toContain('50')
    const labels = [...document.querySelectorAll('.map-label')].map((label) => label.textContent)
    expect(labels.some((label) => label?.includes('敌人1'))).toBe(false)
    expect(labels.some((label) => label?.includes('敌人2'))).toBe(true)
    expect(document.querySelector('.map-scale')!.textContent).toContain('米')
  } finally {
    vi.restoreAllMocks()
  }
})

it('hides the map and shows it again from the panel', async () => {
  await open()
  const show = screen.getByRole('button', { name: '显示角色名' })
  expect(show.getAttribute('aria-pressed')).toBe('false')
  press(show)
  expect(screen.getByRole('button', { name: '显示角色名' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByRole('button', { name: '显示地图' })).toBeNull()
  press(screen.getByRole('button', { name: '收起地图' }))
  expect(document.querySelector('.map-wrapper')).toBeNull()
  expect(document.querySelector('.side-panel.alone')).toBeTruthy()
  press(screen.getByRole('button', { name: '显示地图' }))
  expect(document.querySelector('.map-wrapper')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '显示地图' })).toBeNull()
})

it('keeps the skill icons of the lanes in place while playback scrolls the window', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  const seconds = Array.from({ length: 60 }, (_, i) => i * 1000)
  // The first buff leaves the window before the last one, which has to stay the same element.
  const buffs = [0, 15_000, 30_000]
  try {
    await open(
      replayData({
        fight: { visitId: 'v', fightId: 'f', durationMs: 60_000 },
        actors: [member(0, 19, '骑士'), enemy(1, true)],
        actions: [
          { actionId: 9, name: '先锋剑', gcd: true, lane: null, durationMs: null, sustained: false },
          { actionId: 7385, name: '武装戍卫', gcd: false, lane: 'buff', durationMs: 20_000, sustained: false },
          { actionId: 7531, name: '铁壁', gcd: false, lane: 'buff', durationMs: 20_000, sustained: false },
        ],
        uses: {
          t: Uint32Array.from([...seconds, ...buffs]),
          actor: new Uint16Array(seconds.length + buffs.length),
          action: Uint16Array.from([...seconds.map(() => 0), 1, 1, 2]),
        },
      }),
    )
    press(screen.getByRole('button', { name: '技能轴' }))
    press(screen.getByRole('button', { name: '30 秒' }))
    press(screen.getByRole('button', { name: '播放' }))
    // Past 90% of the first window, so playback has begun to move it.
    act(() => vi.advanceTimersByTime(29_000))
    const use = () => document.querySelector('.use[title^="0:30.0 "]')
    const buff = () => document.querySelector('.lane-use[title^="铁壁"]')
    const [before, buffBefore] = [use(), buff()]
    expect(before).not.toBeNull()
    expect(buffBefore).not.toBeNull()
    act(() => vi.advanceTimersByTime(20_000))
    expect(use()).toBe(before)
    expect(buff()).toBe(buffBefore)
  } finally {
    vi.restoreAllMocks()
  }
})

it('draws the bars of the sustained raid buffs faint and under the others, and every icon over the bars', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  try {
    await open(
      replayData({
        fight: { visitId: 'v', fightId: 'f', durationMs: 60_000 },
        actors: [member(0, 23, '诗人'), enemy(1, true)],
        actions: [
          { actionId: 118, name: '战斗之声', gcd: false, lane: 'buff', durationMs: 20_000, sustained: false },
          { actionId: 3559, name: '放浪神的小步舞曲', gcd: false, lane: 'buff', durationMs: 45_000, sustained: true },
        ],
        // The sustained one is used last, and still comes first in the lane
        uses: { t: Uint32Array.from([1000, 2000]), actor: new Uint16Array(2), action: Uint16Array.from([0, 1]) },
      }),
    )
    press(screen.getByRole('button', { name: '技能轴' }))
    const name = (item: Element) => item.getAttribute('title')?.split(' · ')[0]
    const drawn = [...document.querySelectorAll('.lane.buff .lane-bar, .lane.buff .lane-use')]
    // In the order they are drawn: the bars, then the icons, so that no bar covers an icon
    expect(drawn.map((item) => item.className)).toEqual([
      'lane-bar role-dps sustained',
      'lane-bar role-dps',
      'lane-use',
      'lane-use',
    ])
    expect(drawn.map(name)).toEqual(['放浪神的小步舞曲', '战斗之声', '放浪神的小步舞曲', '战斗之声'])
  } finally {
    vi.restoreAllMocks()
  }
})

it('asks again for an icon whose request failed when the review opens again', async () => {
  // A job no other test shows, since the page keeps its icons across reviews.
  const replay = replayData({
    fight: { visitId: 'v', fightId: 'f', durationMs: 60_000 },
    actors: [member(0, 38, '舞者')],
  })
  const requested: string[] = []
  const icon = async (key: string): Promise<Value> => {
    requested.push(key)
    throw new Error('Game data is not open')
  }
  await open(replay, icon)
  await act(async () => {})
  expect(requested).toContain('job:38')
  cleanup()
  await open(replay, icon)
  await act(async () => {})
  expect(requested.filter((key) => key === 'job:38')).toHaveLength(2)
})

it('changes the filter only from the member filter', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  try {
    await open()
    const checked = () => memberBoxes().map((box) => box.checked)
    const all = checked()
    expect(all).toEqual([true, true, true])
    press(screen.getByRole('button', { name: '详细数据' }))
    const row = document.querySelector('tr.actor')!
    press(row.querySelector('.icon')!)
    expect(checked()).toEqual(all)
    expect(document.querySelector('tr.actor')!.getAttribute('aria-expanded')).toBe('true')
    press(tab('Buff'))
    press(document.querySelector('.uptime-head .icon-slot .icon')!)
    expect(checked()).toEqual(all)
    press(document.querySelector('.map-member')!)
    expect(checked()).toEqual(all)
    press(screen.getByRole('button', { name: '技能轴' }))
    press(document.querySelector('.label.member')!)
    expect(checked()).toEqual(all)
  } finally {
    vi.restoreAllMocks()
  }
})

it('opens the member filter from its button and changes the members in it', async () => {
  await open()
  const trigger = screen.getByRole('button', { name: '角色：全部' })
  const dialog = memberFilter()
  expect(trigger.getAttribute('popovertarget')).toBe(dialog.id)
  expect(dialog.getAttribute('popover')).toBe('auto')
  expect(dialog.getAttribute('role')).toBe('dialog')
  expect(dialog.getAttribute('aria-label')).toBe('选择角色')
  const filter = within(dialog)
  const pressed = (name: string) => filter.getByRole('button', { hidden: true, name }).getAttribute('aria-pressed')
  expect(pressed('全部')).toBe('true')
  // Unchecking one of everyone leaves the others
  press(memberBox('白魔'))
  expect(memberBoxes().map((box) => box.checked)).toEqual([true, false, true])
  expect(pressed('全部')).toBe('false')
  expect(screen.getByRole('button', { name: /^角色：/ }).textContent).not.toContain('全部')
  press(only('诗人'))
  expect(memberBoxes().map((box) => box.checked)).toEqual([false, false, true])
  // Unchecking the last one goes back to everyone
  press(memberBox('诗人'))
  expect(memberBoxes().map((box) => box.checked)).toEqual([true, true, true])
  press(filter.getByRole('button', { hidden: true, name: '治疗' }))
  expect(memberBoxes().map((box) => box.checked)).toEqual([false, true, false])
  expect(pressed('治疗')).toBe('true')
  press(filter.getByRole('button', { hidden: true, name: '全部' }))
  expect(pressed('全部')).toBe('true')
})

it('shows the span in the header once one is selected, with a button that clears it', async () => {
  mockLaneRect()
  try {
    await open()
    expect(document.querySelector('.span-label')).toBeNull()
    const ruler = document.querySelector<HTMLElement>('.lane.ruler')!
    fireEvent.pointerDown(ruler, { clientX: 100 })
    fireEvent.pointerMove(document, { clientX: 250 })
    fireEvent.pointerUp(document, { clientX: 250 })
    const label = document.querySelector('.replay-head .span-label')!
    expect(label.textContent).toContain('0:10.0 – 0:25.0（15.0 秒）')
    press(screen.getByRole('button', { name: '清除时间段' }))
    expect(document.querySelector('.span-label')).toBeNull()
  } finally {
    vi.restoreAllMocks()
  }
})

it('keeps the back button and the title while the review loads', async () => {
  const command = () => new Promise<Value>(() => {})
  render(
    <Bridge.Provider value={{ view: {} as ViewBridge, command }}>
      <ReplayView visitId="v" fightId="f" statistics={statistics} visit={undefined} onBack={() => {}} />
    </Bridge.Provider>,
  )
  expect(screen.getByText('正在读取日志').className).toBe('mojito-empty')
  const back = screen.getByRole('button', { name: '返回概览' })
  expect(document.getElementById(back.getAttribute('interestfor')!)!.getAttribute('popover')).toBe('hint')
})

it('keeps the sizes the panels were dragged to while the review is open', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
  const dragBy = (element: Element, x: number, y: number) => {
    fireEvent.pointerDown(element, { clientX: 500, clientY: 500 })
    fireEvent.pointerMove(document, { clientX: 500 + x, clientY: 500 + y })
    fireEvent.pointerUp(document)
  }
  const side = () => document.querySelector<HTMLElement>('.side-panel')!
  const bottom = () => document.querySelector<HTMLElement>('.bottom')!
  const expand = () => press(screen.getByRole('button', { name: '详细数据' }))
  const measured: { skills: number; tables: number }[] = []
  const rect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains('panel-measure')) return rect.call(this)
    measured.push({
      skills: this.querySelectorAll('tr.skill').length,
      tables: this.querySelectorAll('table.detail').length,
    })
    return { ...rect.call(this), width: 520 }
  })
  const collapse = () => press(screen.getByRole('button', { name: '收起' }))
  try {
    await open()
    expect(document.querySelector('.panel-grip')).toBeNull()
    expect(side().style.width).toBe('300px')
    expand()
    // Not dragged yet: as wide as the widest table, measured with the skills of every member open in every table
    expect(measured).toEqual([{ skills: 4, tables: 8 }])
    expect(document.querySelector('.panel-measure')).toBeNull()
    expect(side().style.width).toBe('520px')
    press(tab('Debuff'))
    expect(side().style.width).toBe('520px')
    press(tab('伤害'))
    dragBy(document.querySelector('.panel-grip')!, -450, 0)
    expect(side().style.width).toBe('450px')
    press(tab('治疗'))
    collapse()
    expect(side().style.width).toBe('300px')
    expand()
    expect(side().style.width).toBe('450px')

    press(screen.getByRole('button', { name: '技能轴' }))
    expect(bottom().style.height).toBe('')
    expect(bottom().style.maxHeight).toBe('680px')
    dragBy(document.querySelector('.grip')!, 0, -300)
    expect(bottom().style.height).toBe('300px')
    press(screen.getByRole('button', { name: '技能轴' }))
    expect(bottom().style.height).toBe('')
    press(screen.getByRole('button', { name: '技能轴' }))
    expect(bottom().style.height).toBe('300px')

    cleanup()
    await open()
    expand()
    expect(side().style.width).toBe('520px')
    press(screen.getByRole('button', { name: '技能轴' }))
    expect(bottom().style.height).toBe('')
  } finally {
    vi.restoreAllMocks()
  }
})

it('shows the details of a boss cast above it without moving the time', async () => {
  await open()
  const casts = () => [...document.querySelectorAll<HTMLElement>('.cast')]
  const dialog = () => screen.queryByRole('dialog', { name: '读条详情' })
  press(casts()[1])
  const text = dialog()!.textContent
  expect(text).toContain('大地摇动')
  expect(text).toContain('7982（0x1F2E）')
  expect(text).toContain('4.7 秒')
  expect(text).toContain('在 0:42.0 被打断或取消，读了 2.0 秒')
  expect(dialog()!.querySelectorAll('table.hits tr')).toHaveLength(2)
  expect(dialog()!.querySelector('tr.current')!.textContent).toContain('0:40.0')
  expect(casts()[1].className).toContain('open')
  expect(screen.getByText('0:00.0 / 1:00.0')).toBeTruthy()

  press(casts()[1])
  expect(dialog()).toBeNull()
  press(casts()[0])
  expect(dialog()!.textContent).toContain('完成')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(dialog()).toBeNull()
  press(casts()[0])
  press(document.querySelector('.map-wrapper')!)
  expect(dialog()).toBeNull()

  press(casts()[0])
  press(document.querySelector('.event-mark')!)
  expect(dialog()).toBeNull()
  expect(detail()).toBeTruthy()
  press(casts()[0])
  expect(dialog()).toBeTruthy()
})

const cutscene = { kind: 'cutscene', from: 42_100, to: 55_000 } as const
const withScenes = {
  ...data,
  events: [
    { kind: 'bossIn', t: 0, actor: 3 },
    { kind: 'bossOut', t: 10_000, actor: 3, reason: 'untargetable' },
    { kind: 'bossIn', t: 20_000, actor: 3 },
    { ...cutscene, t: 42_100, edge: 'start' },
    { ...cutscene, t: 55_000, edge: 'end' },
    { kind: 'bossOut', t: 58_000, actor: 3, reason: 'left' },
  ] satisfies ReplayEvent[],
}

it('lists the cutscenes and shows their range and length', async () => {
  await open(withScenes)
  expect(event('过场动画开始').textContent).toContain('0:42.1')
  press(event('过场动画结束'))
  expect(detail()!.textContent).toContain('0:42.1 – 0:55.0 · 12.9 秒')
})

it('writes why a boss left in the list and in its details', async () => {
  await open(withScenes)
  const left = screen.getAllByRole('button', { name: /离开 · / })
  expect(left[0].textContent).toContain('不可选中')
  expect(left[1].textContent).toContain('离开场地')
  press(left[0])
  const rows = [...detail()!.querySelectorAll('table.hits tr')].map((row) => row.textContent)
  expect(rows).toEqual([
    expect.stringContaining('出现'),
    expect.stringContaining('离开（不可选中）'),
    expect.stringContaining('出现'),
    expect.stringContaining('离开（离开场地）'),
  ])
})

it('shades each cutscene in every lane, under what the lane holds', async () => {
  await open(withScenes)
  const lanes = [...document.querySelectorAll('.lane')]
  expect(lanes.length).toBeGreaterThan(0)
  for (const lane of lanes) {
    const shades = lane.querySelectorAll('.cutscene')
    expect(shades).toHaveLength(1)
    expect(shades[0].getAttribute('title')).toBe('过场动画 0:42.1 – 0:55.0')
    expect(lane.firstElementChild).toBe(shades[0])
  }
  expect(document.querySelectorAll('.events .event-mark')).toHaveLength(6)
})

it('moves the time to the press on a shade, as on the lane', async () => {
  await open(withScenes)
  const shade = document.querySelector<HTMLElement>('.lane.casts .cutscene')!
  // Without layout the lane is 1 pixel wide, so this is the middle of the fight
  fireEvent.pointerDown(shade, { clientX: 0.5 })
  fireEvent.pointerUp(document)
  expect(screen.getByText('0:30.0 / 1:00.0')).toBeTruthy()
})

it('draws no shade and lists no cutscene for a fight without any', async () => {
  await open()
  expect(document.querySelector('.cutscene')).toBeNull()
  expect(screen.queryByRole('button', { name: /过场动画/ })).toBeNull()
})

/**
 * r 50 every 2.5 seconds for the knight on the boss 3, 55 under the buff 100 of the white mage from 20 seconds, and on
 * no target from 58.5 seconds; a few for the bard. The knight has 坚守 over the fight and two 战意 that overlap, the
 * boss 易伤 over the fight.
 */
const potencyData = (() => {
  const sample = (t: number, actor: number, r: number, buffed = false, target = 3): PotencySample => ({
    t,
    actor,
    target,
    actionId: 9,
    amount: r * 200,
    potency: 200,
    multiplier: buffed ? 1.1 : 1,
    factors: buffed ? [{ statusId: 100, source: 1, holder: 'caster', value: 1.1 }] : [],
    critical: false,
    direct: false,
  })
  const potency: PotencySample[] = []
  for (let t = 0; t < 58_000; t += 2500) {
    const buffed = t >= 20_000 && t < 30_000
    potency.push(sample(t, 0, buffed ? 55 : 50, buffed))
  }
  potency.push(sample(58_500, 0, 50, false, -1), sample(59_000, 0, 50, false, -1), sample(59_500, 0, 50, false, -1))
  potency.push(sample(1000, 2, 40), sample(2000, 2, 40), sample(3000, 2, 40))
  const status = (actor: number, statusId: number, from: number, to: number) => ({
    actor,
    statusId,
    source: null,
    from,
    to,
    stacks: null,
  })
  return {
    ...data,
    potency: potency.sort((a, b) => a.t - b.t),
    statuses: [
      ...data.statuses,
      status(0, 300, 0, 60_000),
      status(0, 302, 10_000, 30_000),
      status(0, 301, 5_000, 40_000),
      status(3, 400, 0, 60_000),
    ],
    statusInfo: [
      ...data.statusInfo,
      { statusId: 300, name: '坚守', category: 'buff' as const, raidBuff: false },
      { statusId: 301, name: '战意', category: 'buff' as const, raidBuff: false },
      { statusId: 302, name: '战意', category: 'buff' as const, raidBuff: false },
      { statusId: 400, name: '易伤', category: 'debuff' as const, raidBuff: false },
    ],
  }
})()
const POTENCY_NOTE = '基准值和每威力伤害根据角色威力表和已知 buff 效果估算，仅供参考。'
/** The members the damage per potency can show, and the one it shows */
const potencySelect = () => screen.getByRole('combobox', { name: '每威力伤害的角色' }) as HTMLSelectElement
const potencyMembers = () => ({
  options: [...potencySelect().options].map((option) => option.textContent),
  picked: potencySelect().selectedOptions[0]?.textContent,
})
const pickPotency = (name: string) => {
  const option = [...potencySelect().options].find((item) => item.textContent?.startsWith(name))!
  fireEvent.change(potencySelect(), { target: { value: option.value } })
}
const potencyLane = () => document.querySelectorAll<HTMLElement>('.lane.curve')[1]
const potencyTip = () => document.querySelector<HTMLElement>('.floating-tip.potency-tip')
const expandTimeline = () => press(screen.getByRole('button', { name: '技能轴' }))
it('shows the curves only while the timeline is expanded', async () => {
  await open(potencyData)
  expect(screen.queryByText('每秒伤害')).toBeNull()
  expect(document.querySelector('.lane.curve')).toBeNull()
  expandTimeline()
  expect(document.querySelectorAll('.lane.curve')).toHaveLength(2)
  fireEvent.pointerEnter(document.querySelector('.potency-region')!)
  expect(screen.queryByRole('dialog')).toBeNull()
  press(screen.getByRole('button', { name: '技能轴' }))
  expect(document.querySelector('.lane.curve')).toBeNull()
})

it('draws the damage per second and the damage per potency, for the members that have samples', async () => {
  await open(potencyData)
  expandTimeline()
  const [dpsLabel] = document.querySelectorAll<HTMLElement>('.label.curve-label')
  expect(dpsLabel.firstElementChild!.textContent).toBe('每秒伤害')
  expect([...dpsLabel.querySelectorAll('.curve-legend > span')].map((item) => item.textContent)).toEqual([
    '骑士',
    '白魔',
    '诗人',
  ])
  expect(document.querySelector('.curve-max')!.textContent).toMatch(/^[\d,]+$/)
  expect(screen.getByText('每威力伤害')).toBeTruthy()
  expect(document.querySelectorAll('.lane.curve path.curve-line')).toHaveLength(4)
  expect(potencyMembers()).toEqual({ options: ['骑士', '诗人'], picked: '骑士' })
  expect(screen.getByText('基准 50.0')).toBeTruthy()
  pickPotency('诗人')
  expect(potencyMembers()).toEqual({ options: ['骑士', '诗人'], picked: '诗人' })
  // Only the white mage: no samples
  press(only('白魔'))
  expect(screen.queryByRole('combobox', { name: '每威力伤害的角色' })).toBeNull()
  expect(screen.getByText('没有每威力数据：记录时宿主没有提供，或选中的角色没有可推断威力的命中')).toBeTruthy()
  // The bard was picked; chosen with the knight again, the knight is the default
  press(memberBox('骑士'))
  press(memberBox('诗人'))
  expect(potencyMembers()).toEqual({ options: ['骑士', '诗人'], picked: '骑士' })
})

it('names the only member with samples instead of offering a choice', async () => {
  await open(potencyData)
  expandTimeline()
  press(only('白魔'))
  press(memberBox('诗人'))
  expect(screen.queryByRole('combobox', { name: '每威力伤害的角色' })).toBeNull()
  expect(document.querySelector('.potency-name')!.textContent).toBe('诗人')
})

it('tells how the damage per potency is estimated in the hint of the question mark', async () => {
  await open(potencyData)
  expandTimeline()
  const help = screen.getByRole('button', { name: '说明' })
  const hint = document.getElementById(help.getAttribute('interestfor')!)!
  expect(hint.getAttribute('popover')).toBe('hint')
  expect(hint.textContent).toBe(POTENCY_NOTE)
  expect(help.hasAttribute('title')).toBe(false)
})

it('says so when no member is chosen', async () => {
  await open({
    ...data,
    actors: [data.actors[3]],
    entries: replayData({ actors: [] }).entries,
    statuses: [],
    events: [],
  })
  expandTimeline()
  expect(screen.getAllByText('未选择角色')).toHaveLength(2)
})

it('seeks on a click and selects a span on a drag over the curves', async () => {
  mockLaneRect()
  try {
    await open(potencyData)
    expandTimeline()
    const [dps, potency] = document.querySelectorAll<HTMLElement>('.lane.curve')
    fireEvent.pointerDown(dps, { clientX: 150 })
    fireEvent.pointerUp(document, { clientX: 150 })
    expect(screen.getByText('0:15.0 / 1:00.0')).toBeTruthy()
    fireEvent.pointerDown(potency, { clientX: 100 })
    fireEvent.pointerMove(document, { clientX: 300 })
    fireEvent.pointerUp(document, { clientX: 300 })
    expect(document.querySelector('.replay-head .span-label')!.textContent).toContain('0:10.0 – 0:30.0')
  } finally {
    vi.restoreAllMocks()
  }
})

it('tells the time, the damage per potency, the baseline and the statuses of the member and the boss', async () => {
  mockLaneRect()
  try {
    await open(potencyData)
    expandTimeline()
    fireEvent.pointerMove(potencyLane(), { clientX: 150 })
    const tip = potencyTip()!
    const text = tip.textContent!
    expect(text).toContain(clockText(15_000))
    expect(text).toContain('每威力伤害 50.0')
    expect(text).toContain('基准值 50.0')
    expect(text).toContain('角色状态')
    expect(text).toContain('首领状态 · 敌人3')
    const [own, boss] = [...tip.querySelectorAll('.status-chips')].map((chips) =>
      [...chips.querySelectorAll('.status-chip')].map((item) => item.textContent),
    )
    // 战意 counts once; 增益 ended at 10 seconds
    expect(own).toEqual(['坚守', '战意'])
    expect(boss).toEqual(['易伤'])
    expect(tip.getAttribute('role')).toBe('tooltip')
    for (const gone of ['换算', '窗口', '暴击倍率', '暴击样本不足', '偏离']) expect(text).not.toContain(gone)

    // The samples from 58.5 seconds hit no target
    fireEvent.pointerMove(potencyLane(), { clientX: 590 })
    expect(potencyTip()!.textContent).not.toContain('首领状态')
    fireEvent.pointerLeave(potencyLane())
    expect(potencyTip()).toBeNull()
  } finally {
    vi.restoreAllMocks()
  }
})

it('keeps the background and the arrow of a region, with the tip of the lane over it', async () => {
  await open(potencyData)
  expandTimeline()
  const region = document.querySelector<HTMLElement>('.potency-region')!
  expect(region.className).toContain('up')
  expect(region.querySelector('.potency-arrow')!.getAttribute('aria-label')).toBe('高于基准')
  expect(region.querySelector('.potency-arrow svg.lucide')).toBeTruthy()
  fireEvent.pointerEnter(region)
  fireEvent.pointerMove(region)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(potencyTip()!.textContent).toContain('基准值 50.0')
})

it('opens the help of the review from its button', async () => {
  await open()
  const button = screen.getByRole('button', { name: '操作说明' })
  const help = document.getElementById(button.getAttribute('popovertarget')!)!
  expect(help.getAttribute('popover')).toBe('auto')
  expect(help.getAttribute('role')).toBe('dialog')
  expect(help.textContent).toContain('在刻度上拖动选取时间段')
})

it('writes the name of a cast only in a bar wide enough for it', async () => {
  // 800 pixels for the fight of 60 seconds: the finished cast is 62 pixels, the cancelled one 26
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  try {
    await open()
    const casts = [...document.querySelectorAll<HTMLElement>('.cast')]
    expect(casts.map((cast) => cast.textContent)).toEqual(['大地摇动', ''])
    expect(casts.map((cast) => cast.getAttribute('aria-label'))).toEqual(['大地摇动', '大地摇动'])
  } finally {
    vi.restoreAllMocks()
  }
})

it('tells how to select a span over the ticks until one is selected', async () => {
  mockLaneRect()
  try {
    await open()
    const ruler = document.querySelector<HTMLElement>('.lane.ruler')!
    fireEvent.pointerMove(ruler, { clientX: 100 })
    expect(screen.getByRole('tooltip').textContent).toBe('拖动选取时间段')
    fireEvent.pointerLeave(ruler)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerDown(ruler, { clientX: 100 })
    fireEvent.pointerMove(document, { clientX: 250 })
    fireEvent.pointerUp(document, { clientX: 250 })
    fireEvent.pointerMove(ruler, { clientX: 100 })
    expect(screen.queryByRole('tooltip')).toBeNull()
  } finally {
    vi.restoreAllMocks()
  }
})

it('draws the raid buffs as bars without icons and leaves out the weaponskills past two minutes', async () => {
  const seconds = Array.from({ length: 30 }, (_, i) => i * 10_000)
  await open(
    replayData({
      fight: { visitId: 'v', fightId: 'f', durationMs: 300_000 },
      actors: [member(0, 23, '诗人'), enemy(1, true)],
      actions: [
        { actionId: 118, name: '战斗之声', gcd: false, lane: 'buff', durationMs: 20_000, sustained: false },
        { actionId: 97, name: '强力射击', gcd: true, lane: null, durationMs: null, sustained: false },
      ],
      uses: {
        t: Uint32Array.from([0, ...seconds]),
        actor: Uint16Array.from([0, ...seconds.map(() => 0)]),
        action: Uint16Array.from([0, ...seconds.map(() => 1)]),
      },
    }),
  )
  expect(document.querySelector('.lanes.dense')).toBeTruthy()
  expect(document.querySelectorAll('.lane.buff .lane-bar')).toHaveLength(1)
  expect(document.querySelectorAll('.lane.buff .lane-use')).toHaveLength(0)
  press(screen.getByRole('button', { name: '技能轴' }))
  const lane = document.querySelector('.lane.member')!
  expect(lane.querySelectorAll('.use-line.ability')).toHaveLength(1)
  expect(lane.querySelectorAll('.use-line.gcd')).toHaveLength(0)
  press(screen.getByRole('button', { name: '1 分钟' }))
  expect(document.querySelector('.lanes.dense')).toBeNull()
  expect(document.querySelectorAll('.lane.buff .lane-use')).toHaveLength(1)
})

/** Nine members, the last of them dealing the most damage */
const raid = replayData({
  fight: { visitId: 'v', fightId: 'f', durationMs: 60_000 },
  actors: [...Array.from({ length: 9 }, (_, i) => member(i, 23, `成员${i + 1}`)), enemy(9, true)],
  entries: [
    { t: 1000, actor: 0, other: 9, skill: 'action:9', field: 'damage', amount: 2000, hit: 1 },
    { t: 1000, actor: 4, other: 9, skill: 'action:9', field: 'damage', amount: 5000, hit: 1 },
    { t: 1000, actor: 8, other: 9, skill: 'action:9', field: 'damage', amount: 9000, hit: 1 },
  ],
})

it('lists seven members in the legend of the damage per second and counts them all in the eighth place', async () => {
  await open(raid)
  expandTimeline()
  const legend = [...document.querySelectorAll('.curve-legend > span')].map((item) => item.textContent)
  expect(legend).toEqual(['成员1', '成员2', '成员3', '成员4', '成员5', '成员6', '成员7', '等 9 人'])
  expect(document.querySelectorAll('.lane.curve')[0].querySelectorAll('path.curve-line')).toHaveLength(9)
})

it('orders the members in the tip of the damage per second by their value', async () => {
  mockLaneRect()
  try {
    await open(raid)
    expandTimeline()
    fireEvent.pointerMove(document.querySelectorAll('.lane.curve')[0], { clientX: 15 })
    const rows = [...document.querySelectorAll('.curve-tip .curve-tip-row')].map(
      (row) => row.querySelector('.ellipsis')!.textContent,
    )
    expect(rows.slice(0, 3)).toEqual(['成员9', '成员5', '成员1'])
    expect(rows).toHaveLength(9)
  } finally {
    vi.restoreAllMocks()
  }
})
