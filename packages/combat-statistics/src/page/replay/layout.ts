/** The map never gets narrower or the middle row lower than this */
export const MIN_MAP_WIDTH = 260
export const MIN_MIDDLE_HEIGHT = 120
export const PANEL_COLLAPSED = 300
/** The collapsed panel never takes more than this share of the middle row */
export const PANEL_SHARE = 0.4
export const MIN_BOTTOM = 190

/** The widest the side panel may be in a middle row of this width */
export function panelLimit(middleWidth: number): number {
  return Math.max(0, middleWidth - MIN_MAP_WIDTH)
}

/**
 * The width of the side panel in a middle row of this width: the whole row while the map is hidden; expanded, what it
 * was dragged to, otherwise the width its content was measured to need, null while neither is known.
 */
export function panelWidth(
  middleWidth: number,
  expanded: boolean,
  dragged: number | null,
  fitted: number | null = null,
  mapHidden = false,
): number | null {
  if (mapHidden) return middleWidth
  const limit = panelLimit(middleWidth)
  const least = Math.min(PANEL_COLLAPSED, middleWidth * PANEL_SHARE, limit)
  if (!expanded) return least
  const wanted = dragged ?? fitted
  if (wanted === null) return null
  return Math.min(limit, Math.max(least, wanted))
}

/**
 * The highest the expanded skill timeline may be: what leaves the middle row its minimum, but never below its own
 * minimum.
 * @param room The height the middle row and the timeline share
 */
export function bottomLimit(room: number): number {
  return Math.max(MIN_BOTTOM, room - MIN_MIDDLE_HEIGHT)
}

/** The height of the expanded skill timeline, or null when it was never dragged, so that it takes its content's */
export function bottomHeight(room: number, dragged: number | null): number | null {
  if (dragged === null) return null
  return Math.min(bottomLimit(room), Math.max(MIN_BOTTOM, dragged))
}
