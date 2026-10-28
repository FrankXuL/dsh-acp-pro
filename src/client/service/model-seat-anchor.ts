/**
 * Panel placement for the model picker. Kept as pure geometry so the clamping rules are testable
 * without a layout engine: the panel is `position: fixed` and anchored above the trigger, and it
 * must stay inside the viewport no matter how the surrounding layout moves (window resize, sidebar
 * drag, composer reflow).
 */

export interface Rect {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

export interface PanelAnchor {
  left: number
  bottom: number
  maxHeight: number
  /** Never wider than the room left between the viewport margins. */
  maxWidth: number
}

/** Margin between the panel and the viewport edges. */
export const VIEWPORT_MARGIN = 8
/** Gap between the trigger's top edge and the panel's bottom edge. */
export const TRIGGER_GAP = 8
/** Smallest height worth rendering; below this the panel would show less than one row. */
export const MIN_PANEL_HEIGHT = 160

function clamp(value: number, low: number, high: number): number {
  // Guard the inverted range that a viewport narrower than the margins would produce.
  return Math.min(Math.max(value, low), Math.max(low, high))
}

/**
 * Place the panel above the trigger, clamped into the viewport.
 *
 * @param trigger - the trigger button's viewport rect.
 * @param viewport - current viewport size.
 * @param size - the panel's measured (or expected) size.
 * @returns fixed-position coordinates: `left`, distance of the panel's bottom above the viewport
 * bottom (`bottom`), and the height the panel may occupy before it reaches the viewport top.
 */
export function anchorFor(trigger: Rect, viewport: Viewport, size: { width: number, height: number }): PanelAnchor {
  const room = Math.max(0, viewport.width - VIEWPORT_MARGIN * 2)
  // A panel wider than the viewport shrinks; otherwise it is pinned so its right edge stays inside.
  const maxWidth = Math.min(size.width, room)
  const maxLeft = viewport.width - maxWidth - VIEWPORT_MARGIN
  const left = clamp(trigger.left, VIEWPORT_MARGIN, maxLeft)
  const bottom = Math.max(VIEWPORT_MARGIN, viewport.height - trigger.top + TRIGGER_GAP)
  const availableAbove = trigger.top - TRIGGER_GAP - VIEWPORT_MARGIN
  const maxHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(size.height, availableAbove))
  return { left, bottom, maxHeight, maxWidth }
}

/** Whether two rects differ enough to warrant re-anchoring the panel. */
export function rectMoved(previous: Rect | undefined, next: Rect): boolean {
  if (previous === undefined)
    return true
  return previous.left !== next.left
    || previous.top !== next.top
    || previous.width !== next.width
    || previous.height !== next.height
}
