// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { placeTip, useLabelTip } from './FloatingTip.js'

afterEach(cleanup)

const viewport = { width: 1000, height: 600 }
const size = { width: 200, height: 100 }

describe('placeTip below', () => {
  const at = (left: number, top: number) => ({ left, right: left + 20, top, bottom: top + 20 })

  it('goes 4px under the anchor, on its left edge', () => {
    expect(placeTip(at(100, 100), size, 'below', viewport)).toEqual({ left: 100, top: 124 })
  })

  it('takes the right edge of the anchor when it would overflow the right', () => {
    expect(placeTip(at(900, 100), size, 'below', viewport)).toEqual({ left: 720, top: 124 })
  })

  it('goes above the anchor when it would overflow the bottom', () => {
    expect(placeTip(at(100, 500), size, 'below', viewport)).toEqual({ left: 100, top: 396 })
  })

  it('keeps off the left and top edges', () => {
    expect(placeTip(at(100, 20), { width: 990, height: 590 }, 'below', viewport)).toEqual({ left: 8, top: 8 })
  })
})

describe('placeTip beside', () => {
  const line = (x: number, top: number) => ({ left: x, right: x, top, bottom: top + 120 })

  it('goes 8px right of the anchor, 4px under its top', () => {
    expect(placeTip(line(300, 100), size, 'beside', viewport)).toEqual({ left: 308, top: 104 })
  })

  it('goes left of the anchor when it would overflow the right', () => {
    expect(placeTip(line(900, 100), size, 'beside', viewport)).toEqual({ left: 692, top: 104 })
  })

  it('keeps 8px off the bottom when it would overflow it', () => {
    expect(placeTip(line(300, 550), size, 'beside', viewport)).toEqual({ left: 308, top: 492 })
  })

  it('keeps off the top edge', () => {
    expect(placeTip(line(300, -50), size, 'beside', viewport)).toEqual({ left: 308, top: 8 })
  })
})

function Labelled() {
  const { trigger, tip } = useLabelTip('说明')
  return (
    <>
      <button type="button" {...trigger}>
        问
      </button>
      {tip}
    </>
  )
}

describe('useLabelTip', () => {
  it('shows the tip while the pointer is on the trigger', () => {
    render(<Labelled />)
    const button = screen.getByRole('button')
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerEnter(button)
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toBe('说明')
    expect(button.getAttribute('aria-describedby')).toBe(tip.id)
    fireEvent.pointerLeave(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(button.hasAttribute('aria-describedby')).toBe(false)
  })

  it('shows the tip while the trigger has the focus', () => {
    render(<Labelled />)
    const button = screen.getByRole('button')
    fireEvent.focus(button)
    expect(screen.getByRole('tooltip').textContent).toBe('说明')
    fireEvent.blur(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
