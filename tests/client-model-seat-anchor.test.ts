import type { Rect } from '../src/client/service/model-seat-anchor.ts'
import { describe, expect, it } from 'vitest'
import { MIN_PANEL_HEIGHT, TRIGGER_GAP, VIEWPORT_MARGIN, anchorFor, rectMoved } from '../src/client/service/model-seat-anchor.ts'

const TRIGGER: Rect = { left: 300, right: 460, top: 600, bottom: 628, width: 160, height: 28 }
const VIEWPORT = { width: 1200, height: 800 }
const MODELS = { width: 340, height: 360 }

describe('anchorFor', () => {
  it('opens upward above the trigger without touching the viewport edges', () => {
    const anchor = anchorFor(TRIGGER, VIEWPORT, MODELS)
    expect(anchor.left).toBe(300)
    expect(anchor.bottom).toBe(800 - 600 + TRIGGER_GAP)
    expect(anchor.maxHeight).toBe(360)
  })

  it('keeps the panel inside the viewport when the trigger sits near the right edge', () => {
    // The sidebar opening/closing moves the composer; a trigger pushed right must not push the
    // panel past the viewport.
    const anchor = anchorFor({ ...TRIGGER, left: 1150, right: 1190 }, VIEWPORT, MODELS)
    expect(anchor.left).toBe(1200 - 340 - VIEWPORT_MARGIN)
    expect(anchor.left + MODELS.width).toBeLessThanOrEqual(VIEWPORT.width - VIEWPORT_MARGIN)
  })

  it('does not go negative when the composer is dragged to the left edge', () => {
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

  it('shrinks the width instead of hanging past the right edge on a narrow viewport', () => {
    // 756px viewport, 340px panel, trigger on the right: clamping only `left` leaves the panel
    // 66px outside the viewport, which is exactly the sidebar-drag symptom.
    const anchor = anchorFor({ ...TRIGGER, left: 482, right: 642 }, { width: 756, height: 469 }, MODELS)
    expect(anchor.left).toBe(756 - 340 - VIEWPORT_MARGIN)
    expect(anchor.left + MODELS.width).toBeLessThanOrEqual(756 - VIEWPORT_MARGIN)
    // The panel still fits, so it keeps its width; the fix is the clamped `left`.
    expect(anchor.maxWidth).toBe(MODELS.width)
    // Only a viewport narrower than the panel shrinks it.
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
