import type { ConfigFormSnapshot, JsonValue } from '../src/client/types/runtime.ts'
import { describe, expect, it } from 'vitest'
import { resolveSourceIcon, sourceRoutes } from '../src/client/service/model-seat-sources.ts'

function snapshot(agents: Record<string, unknown>): ConfigFormSnapshot {
  return { status: 'ready', value: { agents } as JsonValue, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host' }
}

describe('sourceRoutes', () => {
  it('sorts by display name then route, ignoring configured key order', () => {
    const routes = sourceRoutes(snapshot({
      zebra: { displayName: 'Zulu', command: '/bin/z' },
      alpha: { displayName: 'Alpha', command: '/bin/a' },
      sameB: { displayName: 'Same', command: '/bin/b' },
      sameA: { displayName: 'Same', command: '/bin/c' },
    }))
    expect(routes).toEqual(['alpha', 'sameA', 'sameB', 'zebra'])
  })

  it('drops routes the user disabled so they never reach the rail', () => {
    const routes = sourceRoutes(snapshot({
      on: { displayName: 'On', command: '/bin/on' },
      off: { displayName: 'Off', command: '/bin/off', enabled: false },
    }))
    expect(routes).toEqual(['on'])
  })

  it('keeps a route enabled when the field is absent (older profiles)', () => {
    expect(sourceRoutes(snapshot({ legacy: { displayName: 'Legacy', command: '/bin/l' } }))).toEqual(['legacy'])
  })

  it('is empty for an unavailable snapshot', () => {
    expect(sourceRoutes({ value: undefined })).toEqual([])
  })
})

describe('resolveSourceIcon', () => {
  it('maps a built-in name to an svg glyph', () => {
    expect(resolveSourceIcon({ icon: 'claude' })).toEqual({ kind: 'builtin', name: 'claude' })
    expect(resolveSourceIcon({ icon: 'CODEX' })).toEqual({ kind: 'builtin', name: 'codex' })
  })

  it('passes emoji and urls through as text and image sources', () => {
    expect(resolveSourceIcon({ icon: '🦀' })).toEqual({ kind: 'emoji', text: '🦀' })
    expect(resolveSourceIcon({ icon: 'https://example.com/a.png' })).toEqual({ kind: 'url', url: 'https://example.com/a.png' })
  })

  it('falls back to the first letter of the display name, else the route', () => {
    expect(resolveSourceIcon({ displayName: 'Claude Code' }, 'cc')).toEqual({ kind: 'letter', text: 'C' })
    expect(resolveSourceIcon({}, 'qoder')).toEqual({ kind: 'letter', text: 'Q' })
    expect(resolveSourceIcon({ displayName: '  ' }, '')).toEqual({ kind: 'letter', text: '?' })
  })

  it('ignores an unknown icon instead of failing', () => {
    expect(resolveSourceIcon({ icon: 'not-a-real-icon', displayName: 'Zed' }, 'zed')).toEqual({ kind: 'letter', text: 'Z' })
  })
})
