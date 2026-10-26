import { describe, expect, it } from 'vitest'
import { requestImageDimensions, requestImageTarget } from '../src/host/service/request-image.ts'

const BUDGET = { maxPixels: 4_194_304, maxBytes: 1_048_576 }

describe('request image target', () => {
  it('keeps sources inside the pixel budget without enlarging them', () => {
    expect(requestImageDimensions(800, 600, BUDGET.maxPixels)).toEqual({ width: 800, height: 600 })
    const landscape = requestImageDimensions(3000, 2000, BUDGET.maxPixels)
    expect(landscape).toEqual({ width: 2508, height: 1672 })
    expect(landscape.width * landscape.height).toBeLessThanOrEqual(BUDGET.maxPixels)
    const portrait = requestImageDimensions(2000, 3000, BUDGET.maxPixels)
    expect(portrait).toEqual({ width: 1672, height: 2508 })
    expect(portrait.width * portrait.height).toBeLessThanOrEqual(BUDGET.maxPixels)
    // An extreme aspect ratio still yields at least one pixel on the short edge,
    // and the long edge shrinks until the pair fits the budget.
    expect(requestImageDimensions(40_000, 3, 100)).toEqual({ width: 100, height: 1 })
  })

  it('builds the exact size the attachment store expects, not the budget', () => {
    const ref = { attachmentId: 'sha256:abc', mediaType: 'image/png', width: 3000, height: 2000, bytes: 9 }
    expect(requestImageTarget(ref, BUDGET)).toEqual({ width: 2508, height: 1672, maxBytes: BUDGET.maxBytes })
  })

  it('refuses a reference whose source dimensions are unusable', () => {
    expect(() => requestImageTarget(null, BUDGET)).toThrow(/not an object/)
    expect(() => requestImageTarget({ width: 10 }, BUDGET)).toThrow(/no usable height/)
    expect(() => requestImageTarget({ width: 0, height: 10 }, BUDGET)).toThrow(/no usable width/)
  })
})
