/**
 * Layering guards for the Host/Client split.
 *
 * The restructure (ADR-0001) only holds if nothing quietly re-couples the layers. These are
 * static checks over source text: they cost no runtime seam and fail the moment someone adds a
 * reverse import or re-bloats a file.
 *
 * Deliberately not asserted here: anything about behaviour. Behaviour belongs in the existing
 * runtime seams (plugin wiring, adapter harness, client component tests).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')


/** Physical line count, ignoring a trailing newline so a file's size never drifts by one. */
function countLines(file: string): number {
  const text = readFileSync(file, 'utf8')
  return text.length === 0 ? 0 : text.replace(/\n$/, '').split('\n').length
}

/** Every source file under a directory, recursively. */
function sourcesUnder(directory: string): string[] {
  const out: string[] = []
  const walk = (current: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(current)
    }
    catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry)
      if (statSync(full).isDirectory())
        walk(full)
      else if (/\.(ts|tsx)$/.test(entry))
        out.push(full)
    }
  }
  walk(directory)
  return out
}

/** Import specifiers appearing in a file. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)].map(match => match[1]!)
}

/** Resolve one relative import to a workspace-relative path for readable failures. */
function resolveRelative(from: string, specifier: string): string {
  return relative(ROOT, join(from, '..', specifier))
}

describe('layering', () => {
  const domainFiles = sourcesUnder(join(SRC, 'host', 'domain'))
  const serviceFiles = sourcesUnder(join(SRC, 'client', 'service'))

  it('host/domain does not import surface or transport', () => {
    const violations: string[] = []
    for (const file of domainFiles) {
      for (const specifier of importsOf(file)) {
        const resolved = resolveRelative(file, specifier)
        if (resolved.includes('/host/surface/') || resolved.includes('/host/transport/'))
          violations.push(`${relative(ROOT, file)} -> ${specifier}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('host/domain does not reach into host services', () => {
    // A domain module must stay testable without a cordis Context. Importing the adapter, the
    // record sink, or anything that owns `ctx` would silently re-couple it.
    const violations: string[] = []
    for (const file of domainFiles) {
      for (const specifier of importsOf(file)) {
        if (specifier.includes('/service/'))
          violations.push(`${relative(ROOT, file)} -> ${specifier}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('client/service does not import react', () => {
    const violations: string[] = []
    for (const file of serviceFiles) {
      const text = readFileSync(file, 'utf8')
      if (/from\s+'react(-dom)?(\/[^']*)?'/.test(text))
        violations.push(relative(ROOT, file))
    }
    expect(violations).toEqual([])
  })

  /** Files the restructure (ADR-0001) is scheduled to split; each is removed from this list as
   *  its slice lands. Anything else over the ceiling is a regression, not a known debt. */
  const SCHEDULED_SPLITS = [
    'src/host/service/acp-adapter.ts',
    'src/host/transport/acp-agent.ts',
    'src/client/components/model-seat.tsx',
  ]

  it('keeps host and client source files within the agreed size ceiling', () => {
    const ceiling = 400
    const oversized: string[] = []
    for (const file of [...sourcesUnder(join(SRC, 'host')), ...sourcesUnder(join(SRC, 'client'))]) {
      const path = relative(ROOT, file)
      if (SCHEDULED_SPLITS.includes(path))
        continue
      const lines = countLines(file)
      if (lines > ceiling)
        oversized.push(`${path} (${lines} lines)`)
    }
    expect(oversized).toEqual([])
  })

  it('shrinks the scheduled splits as their slices land', () => {
    // Guards against the debt being forgotten: each file may only get smaller, and a slice that
    // removes it entirely should also remove its entry above.
    const BASELINE = new Map([
      ['src/host/service/acp-adapter.ts', 1517],
      ['src/host/transport/acp-agent.ts', 846],
      ['src/client/components/model-seat.tsx', 423],
    ])
    const regressed: string[] = []
    for (const path of SCHEDULED_SPLITS) {
      let lines: number
      try {
        lines = countLines(join(ROOT, path))
      }
      catch {
        continue
      }
      const baseline = BASELINE.get(path)!
      if (lines > baseline)
        regressed.push(`${path} grew from ${baseline} to ${lines} lines`)
    }
    expect(regressed).toEqual([])
  })
})
