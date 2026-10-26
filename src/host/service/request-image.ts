import { PLUGIN_ID } from '../../shared/constants.ts'

/** Pixel and byte ceilings one route accepts for a request image. */
export interface RequestImageBudget {
  maxPixels: number
  maxBytes: number
}

/**
 * What `attachments.readImageRequest` resizes to: exact dimensions, not a policy. The
 * attachment store keys its cached versions by these numbers, so a target built the way the
 * built-in routes build theirs reuses their encoded version instead of making another one.
 */
export interface RequestImageTarget {
  width: number
  height: number
  maxBytes: number
}

/**
 * Aspect-preserving integer dimensions inside a total-pixel budget: rounded inward, never
 * enlarging. Same geometry `@deepseek-ai/dsh-attachment` applies, reproduced here because the
 * host supplies that package at runtime and this plugin bundles none of it.
 */
export function requestImageDimensions(width: number, height: number, maxPixels: number): { width: number, height: number } {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)))
  if (scale === 1)
    return { width, height }
  if (width >= height) {
    let projectedWidth = Math.max(1, Math.floor(width * scale))
    let projectedHeight = Math.max(1, Math.round(projectedWidth * height / width))
    while (projectedWidth * projectedHeight > maxPixels && projectedWidth > 1) {
      projectedWidth -= 1
      projectedHeight = Math.max(1, Math.round(projectedWidth * height / width))
    }
    return { width: projectedWidth, height: projectedHeight }
  }
  let projectedHeight = Math.max(1, Math.floor(height * scale))
  let projectedWidth = Math.max(1, Math.round(projectedHeight * width / height))
  while (projectedWidth * projectedHeight > maxPixels && projectedHeight > 1) {
    projectedHeight -= 1
    projectedWidth = Math.max(1, Math.round(projectedHeight * width / height))
  }
  return { width: projectedWidth, height: projectedHeight }
}

function sideOf(ref: Record<string, unknown>, side: 'width' | 'height'): number {
  const value = ref[side]
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
    throw new Error(`${PLUGIN_ID}: image attachment has no usable ${side}; cannot size its request version`)
  return value
}

/** The request target for one durable image reference, which carries the source dimensions. */
export function requestImageTarget(ref: unknown, budget: RequestImageBudget): RequestImageTarget {
  if (typeof ref !== 'object' || ref === null)
    throw new Error(`${PLUGIN_ID}: image attachment reference is not an object`)
  const source = ref as Record<string, unknown>
  return {
    ...requestImageDimensions(sideOf(source, 'width'), sideOf(source, 'height'), budget.maxPixels),
    maxBytes: budget.maxBytes,
  }
}
