import type { Rect } from '../src/client/service/model-seat-anchor.ts'
import { describe, expect, it } from 'vitest'
import { MIN_PANEL_HEIGHT, TRIGGER_GAP, VIEWPORT_MARGIN, anchorFor, rectMoved } from '../src/client/service/model-seat-anchor.ts'

const TRIGGER: Rect = { left: 300, right: 460, top: 600, bottom: 628, width: 160, height: 28 }
const VIEWPORT = { width: 1200, height: 800 }
const MODELS = { width: 340, height: 360 }

describe('anchorFor', () => {
  it('opens upward above the trigger without touching the viewport edges', () => {
    const anchor = anchorFor(TRIGGER, VIEWPORT, MODELS)
    // Right-aligned to the trigger, like the native picker: the panel's right edge tracks the
    // trigger's right edge rather than its left edge.
    expect(anchor.left).toBe(TRIGGER.right - MODELS.width)
    expect(anchor.bottom).toBe(800 - 600 + TRIGGER_GAP)
    expect(anchor.maxHeight).toBe(360)
  })

  it('keeps the panel inside the viewport when the trigger sits near the right edge', () => {
    // The sidebar opening/closing moves the composer; a trigger pushed right must not push the
    // panel past the viewport.
    const anchor = anchorFor({ ...TRIGGER, left: 1150, right: 1190 }, VIEWPORT, MODELS)
    // Still right-aligned to the trigger: 1190 - 340 = 850, comfortably inside the 8px margin.
    expect(anchor.left).toBe(1190 - MODELS.width)
    expect(anchor.left + MODELS.width).toBeLessThanOrEqual(VIEWPORT.width - VIEWPORT_MARGIN)
  })

  it('stays right-aligned on a narrow viewport instead of shrinking the card', () => {
    // The sidebar-drag symptom: a 340px card above a right-hand trigger used to be left-aligned,
    // overflow the edge, and get clamped down to 240px — visibly shrinking the inner layout.
    const anchor = anchorFor({ ...TRIGGER, left: 482, right: 642 }, { width: 756, height: 469 }, MODELS)
    expect(anchor.maxWidth).toBe(MODELS.width)
    expect(anchor.left).toBe(642 - 340)
    expect(anchor.left + anchor.maxWidth).toBeLessThanOrEqual(756 - VIEWPORT_MARGIN)
  })

  it('does not go negative when the composer is dragged to the left edge', () => {
    // Right-aligned would place it at 160-340 < 0, so it pins to the left margin.
    expect(anchorFor({ ...TRIGGER, left: 0, right: 160 }, VIEWPORT, MODELS).left).toBe(VIEWPORT_MARGIN)
  })

  it('shrinks the panel when the trigger sits near the top', () => {
    const anchor = anchorFor({ ...TRIGGER, top: 200, bottom: 228 }, VIEWPORT, MODELS)
    expect(anchor.maxHeight).toBe(200 - TRIGGER_GAP - VIEWPORT_MARGIN)
  })

  it('never shrinks below one usable row', () => {
    const anchor = anchorFor({ ...TRIGGER, top: 20, bottom: 48 }, VIEWPORT, MODELS)
    expect(anchor.maxHeight).toBe(MIN_PANEL_HEIGHT)
  })

  it('survives a viewport narrower than the panel plus margins', () => {
    const anchor = anchorFor({ ...TRIGGER, left: 40 }, { width: 300, height: 700 }, MODELS)
    // Clamped to the left margin rather than a negative offset.
    expect(anchor.left).toBe(VIEWPORT_MARGIN)
  })

  it('only shrinks the width when the viewport itself is narrower than the panel', () => {
    expect(anchorFor({ ...TRIGGER, left: 100 }, { width: 300, height: 700 }, MODELS).maxWidth).toBe(300 - VIEWPORT_MARGIN * 2)
  })

  it('keeps the full width on a wide viewport', () => {
    expect(anchorFor(TRIGGER, VIEWPORT, MODELS).maxWidth).toBe(MODELS.width)
  })
})

describe('rectMoved', () => {
  it('re-anchors on first measurement', () => {
    expect(rectMoved(undefined, TRIGGER)).toBe(true)
  })

  it('notices a composer shift (sidebar drag) even when the viewport size is unchanged', () => {
    expect(rectMoved(TRIGGER, { ...TRIGGER, left: TRIGGER.left + 200, right: TRIGGER.right + 200 })).toBe(true)
  })

  it('notices a vertical shift (window resize or composer growth)', () => {
    expect(rectMoved(TRIGGER, { ...TRIGGER, top: TRIGGER.top - 100, bottom: TRIGGER.bottom - 100 })).toBe(true)
  })

  it('stays put when nothing moved', () => {
    expect(rectMoved(TRIGGER, { ...TRIGGER })).toBe(false)
  })
})

describe('dragging the sidebar', () => {
  it('keeps the panel inside the viewport for every intermediate trigger position', () => {
    // A sidebar drag walks the composer across the viewport; every frame must stay clamped.
    const viewport = { width: 756, height: 469 }
    const size = { width: 340, height: 160 }
    const widths = new Set<number>()
    for (let left = 0; left <= viewport.width; left += 37) {
      const anchor = anchorFor({ left, right: left + 160, top: 341, bottom: 369, width: 160, height: 28 }, viewport, size)
      expect(anchor.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN)
      expect(anchor.left + anchor.maxWidth).toBeLessThanOrEqual(viewport.width - VIEWPORT_MARGIN)
      widths.add(anchor.maxWidth)
    }
    // The panel never had to shrink on this viewport; only its x position moved.
    expect([...widths]).toEqual([340])
  })

  it('re-anchors on every frame of a drag, but not while the trigger is still', () => {
    let previous: Rect | undefined
    const moved = []
    for (let left = 0; left <= 300; left += 100) {
      const next: Rect = { left, right: left + 160, top: 341, bottom: 369, width: 160, height: 28 }
      moved.push(rectMoved(previous, next))
      previous = next
    }
    expect(moved).toEqual([true, true, true, true])
    expect(rectMoved(previous, { ...previous! })).toBe(false)
  })
})

describe('repeat anchoring', () => {
  it('does not lock the card at a previously clamped width', () => {
    // The measured size must be the panel's natural width: feeding a clamped box back in would
    // keep shrinking the card to the root pane's width on every frame.
    const viewport = { width: 756, height: 469 }
    const natural = { width: 340, height: 360 }
    const first = anchorFor({ left: 482, right: 642, top: 341, bottom: 369, width: 160, height: 28 }, viewport, natural)
    const second = anchorFor({ left: 482, right: 642, top: 341, bottom: 369, width: 160, height: 28 }, viewport, natural)
    expect(second).toEqual(first)
    expect(first.maxWidth).toBe(340)
  })
})

describe('width floor', () => {
  const TRIGGER_RIGHT: Rect = { left: 482, right: 642, top: 341, bottom: 369, width: 160, height: 28 }
  const VIEWPORT_756 = { width: 756, height: 469 }

  it('never shrinks below the pane natural width just because a measurement came back narrow', () => {
    const anchor = anchorFor(TRIGGER_RIGHT, VIEWPORT_756, { width: 240, height: 360 }, 340)
    expect(anchor.maxWidth).toBe(340)
    expect(anchor.left).toBe(642 - 340)
  })

  it('still shrinks below the natural width when the viewport cannot fit it', () => {
    const anchor = anchorFor({ ...TRIGGER_RIGHT, left: 100, right: 260 }, { width: 300, height: 700 }, { width: 240, height: 360 }, 340)
    expect(anchor.maxWidth).toBe(300 - VIEWPORT_MARGIN * 2)
  })

  it('prefers the measured width when it is wider than the natural one', () => {
    expect(anchorFor(TRIGGER_RIGHT, VIEWPORT_756, { width: 400, height: 360 }, 340).maxWidth).toBe(400)
  })
})
