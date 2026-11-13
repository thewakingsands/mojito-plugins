import type { Span } from './aggregate.js'

/** The zoom levels: the length of the window, null for the whole fight */
export const ZOOMS = [
  { label: '整场', ms: null },
  { label: '2 分钟', ms: 120_000 },
  { label: '1 分钟', ms: 60_000 },
  { label: '30 秒', ms: 30_000 },
] as const
export type Zoom = (typeof ZOOMS)[number]['ms']
/** Windows longer than this draw uses as lines, not icons */
export const ICON_WINDOW_MS = 120_000
const TICK_STEPS = [10_000, 30_000, 60_000, 120_000]
const MAX_TICKS = 10
/** Playback moves the window on once the playhead passes this share of it */
const FOLLOW_AT = 0.9
/** A press on the ticks that moves less than this is a click, more a selection */
export const DRAG_PX = 4

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** The window of the zoom centered on the time, within the fight */
export function windowAround(time: number, zoom: number | null, durationMs: number): Span {
  if (zoom === null || zoom >= durationMs) return { from: 0, to: durationMs }
  const from = clamp(time - zoom / 2, 0, durationMs - zoom)
  return { from, to: from + zoom }
}

/** The window moved by a number of milliseconds, within the fight */
export function scrollWindow(window: Span, by: number, durationMs: number): Span {
  const length = window.to - window.from
  const from = clamp(window.from + by, 0, Math.max(0, durationMs - length))
  return { from, to: from + length }
}

/** The window that keeps the playhead in view while playing */
export function follow(window: Span, time: number, durationMs: number): Span {
  const length = window.to - window.from
  if (length >= durationMs) return window
  if (time < window.from || time > window.to) return windowAround(time, length, durationMs)
  if (time <= window.from + length * FOLLOW_AT) return window
  return scrollWindow(window, time - (window.from + length * FOLLOW_AT), durationMs)
}

/** The smallest step that gives at most ten ticks, two minutes at most */
export function tickStep(length: number): number {
  return TICK_STEPS.find((step) => length / step <= MAX_TICKS) ?? TICK_STEPS.at(-1)!
}
export function ticks(window: Span): number[] {
  const step = tickStep(window.to - window.from)
  const result: number[] = []
  for (let t = Math.ceil(window.from / step) * step; t <= window.to; t += step) result.push(t)
  return result
}

/** A press on the ticks: a click at the press when it hardly moved, otherwise a selection between the two */
export function pressed(
  fromTime: number,
  toTime: number,
  movedPx: number,
): { kind: 'click'; time: number } | { kind: 'select'; span: Span } {
  if (Math.abs(movedPx) <= DRAG_PX) return { kind: 'click', time: fromTime }
  return { kind: 'select', span: { from: Math.min(fromTime, toTime), to: Math.max(fromTime, toTime) } }
}

/** Review time as 3:05.2 */
export function clockText(ms: number): string {
  const tenths = Math.max(0, Math.floor(ms / 100))
  const seconds = Math.floor(tenths / 10)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`
}

/** Roughly how wide a character of a cast's name is at the size of the lane's text, without measuring the page */
const CHAR_PX = 12
/** Whether a cast bar this many pixels wide holds its whole name; otherwise it is drawn without one */
export const castLabelShown = (widthPx: number, name: string) => widthPx >= name.length * CHAR_PX + 8
