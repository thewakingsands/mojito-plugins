import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

/** The least distance a tip keeps from the edges of the viewport */
export const TIP_MARGIN = 8

export interface TipAnchor {
  left: number
  right: number
  top: number
  bottom: number
}
type Size = { width: number; height: number }
/** below: under the anchor, as the tip of the ruler; beside: right of the anchor, as the tips of the lanes */
export type TipSide = 'below' | 'beside'

/** Where a tip of the size goes, in viewport coordinates; it flips to the other side when it would overflow */
export function placeTip(anchor: TipAnchor, size: Size, side: TipSide, viewport: Size): { left: number; top: number } {
  let left: number
  let top: number
  if (side === 'below') {
    left = anchor.left
    if (left + size.width > viewport.width - TIP_MARGIN) left = anchor.right - size.width
    top = anchor.bottom + 4
    if (top + size.height > viewport.height - TIP_MARGIN) top = anchor.top - 4 - size.height
  } else {
    left = anchor.right + 8
    if (left + size.width > viewport.width - TIP_MARGIN) left = anchor.left - 8 - size.width
    top = anchor.top + 4
    if (top + size.height > viewport.height - TIP_MARGIN) top = viewport.height - TIP_MARGIN - size.height
  }
  return { left: Math.max(TIP_MARGIN, left), top: Math.max(TIP_MARGIN, top) }
}

/**
 * A tip fixed to the viewport, so that the lanes and labels, which hide their overflow, do not cut it. It stays hidden
 * until measured, so as not to show at a wrong place first.
 */
export function FloatingTip(props: { anchor: TipAnchor; side: TipSide; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  // Without dependencies: a change of the content changes the size as well
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const root = document.documentElement
    const next = placeTip(props.anchor, { width: element.offsetWidth, height: element.offsetHeight }, props.side, {
      width: root.clientWidth,
      height: root.clientHeight,
    })
    setPlace((current) => (current && current.left === next.left && current.top === next.top ? current : next))
  })
  return (
    <div
      ref={ref}
      role="tooltip"
      className={`floating-tip ${props.className}`}
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {props.children}
    </div>
  )
}
