/** Minimal line diff for ACP diff content; bounded so one huge file cannot freeze the view. */

/** One displayed diff line. */
export interface DiffLine {
  readonly kind: 'context' | 'added' | 'removed'
  readonly text: string
}

/** Default per-side line cap; larger diffs fall back to whole old/new blocks. */
export const DIFF_LINE_LIMIT = 400

/** DP cell cap; larger middles fall back to whole old/new blocks. */
const DIFF_CELL_LIMIT = 250_000

/**
 * Compute a line diff between two texts.
 * @param before - old text.
 * @param after - new text.
 * @param limit - maximum lines per side.
 * @returns ordered diff lines, or null when the input exceeds the bounds.
 */
export function lineDiff(before: string, after: string, limit = DIFF_LINE_LIMIT): DiffLine[] | null {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length > limit || b.length > limit)
    return null
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const middleA = a.slice(start, endA)
  const middleB = b.slice(start, endB)
  if (middleA.length * middleB.length > DIFF_CELL_LIMIT)
    return null
  const rows = middleA.length + 1
  const cols = middleB.length + 1
  const table: Uint32Array[] = Array.from({ length: rows }, () => new Uint32Array(cols))
  for (let i = middleA.length - 1; i >= 0; i--) {
    for (let j = middleB.length - 1; j >= 0; j--) {
      table[i]![j] = middleA[i]! === middleB[j]!
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const lines: DiffLine[] = []
  for (let i = 0; i < start; i++) lines.push({ kind: 'context', text: a[i]! })
  let i = 0
  let j = 0
  while (i < middleA.length && j < middleB.length) {
    if (middleA[i]! === middleB[j]!) {
      lines.push({ kind: 'context', text: middleA[i]! })
      i++
      j++
    }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: 'removed', text: middleA[i]! })
      i++
    }
    else {
      lines.push({ kind: 'added', text: middleB[j]! })
      j++
    }
  }
  while (i < middleA.length) lines.push({ kind: 'removed', text: middleA[i++]! })
  while (j < middleB.length) lines.push({ kind: 'added', text: middleB[j++]! })
  for (let k = endA; k < a.length; k++) lines.push({ kind: 'context', text: a[k]! })
  return lines
}
