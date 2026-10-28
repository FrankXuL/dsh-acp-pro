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
    expect(resolveSourceIcon({ displayName: 'Qoder' }, 'qoder')).toEqual({ kind: 'letter', text: 'Q' })
    expect(resolveSourceIcon({}, 'qoder')).toEqual({ kind: 'letter', text: 'Q' })
    expect(resolveSourceIcon({ displayName: '  ' }, '')).toEqual({ kind: 'letter', text: '?' })
  })

  it('auto-detects a built-in icon from the display name when none is configured', () => {
    expect(resolveSourceIcon({ displayName: 'Claude Code' }, 'cc')).toEqual({ kind: 'builtin', name: 'claude' })
    expect(resolveSourceIcon({ displayName: 'Codex' }, 'codex')).toEqual({ kind: 'builtin', name: 'codex' })
    expect(resolveSourceIcon({ displayName: 'OpenCode' }, 'oc')).toEqual({ kind: 'builtin', name: 'opencode' })
    expect(resolveSourceIcon({ displayName: 'Gemini Code Assist' }, 'g')).toEqual({ kind: 'builtin', name: 'gemini' })
    expect(resolveSourceIcon({ displayName: 'DeepSeek Router' }, 'ds')).toEqual({ kind: 'builtin', name: 'deepseek' })
  })

  it('lets an explicit configured icon win over name detection', () => {
    expect(resolveSourceIcon({ displayName: 'Claude Code', icon: '🦀' })).toEqual({ kind: 'emoji', text: '🦀' })
    expect(resolveSourceIcon({ displayName: 'Codex', icon: 'deepseek' })).toEqual({ kind: 'builtin', name: 'deepseek' })
  })

  it('ignores an unknown icon instead of failing', () => {
    expect(resolveSourceIcon({ icon: 'not-a-real-icon', displayName: 'Zed' }, 'zed')).toEqual({ kind: 'letter', text: 'Z' })
  })

  it('detects Antigravity but leaves unrelated names on the initial', () => {
    // Antigravity ships a mark, so its display name resolves to the bundled logo.
    expect(resolveSourceIcon({ displayName: 'Antigravity' }, 'agy')).toEqual({ kind: 'builtin', name: 'antigravity' })
    // "MyFlicker" matches no provider: never guess a wrong logo for it.
    expect(resolveSourceIcon({ displayName: 'MyFlicker' }, 'flick')).toEqual({ kind: 'letter', text: 'M' })
  })
})

describe('provider marks', () => {
  it('resolves a built-in name to a bundled mark instead of a hand-drawn path', async () => {
    const { PROVIDER_SVG, providerIconUrl, MONOCHROME_PROVIDERS } = await import('../src/client/assets/provider-icons.ts')
    expect(Object.keys(PROVIDER_SVG).sort()).toEqual([
      'antigravity', 'claude', 'codex', 'cursor', 'devin', 'fx', 'grok', 'hermes', 'omp', 'opencode', 'pi',
    ])
    const url = providerIconUrl('codex')
    expect(url?.startsWith('data:image/svg+xml')).toBe(true)
    expect(decodeURIComponent(url!)).toContain('<svg')
    expect(MONOCHROME_PROVIDERS.has('opencode')).toBe(true)
    expect(MONOCHROME_PROVIDERS.has('codex')).toBe(false)
  })

  it('carries marks for the providers this machine runs', async () => {
    const { PROVIDER_SVG } = await import('../src/client/assets/provider-icons.ts')
    for (const id of ['claude', 'codex', 'opencode', 'antigravity'])
      expect(PROVIDER_SVG[id]).toContain('<svg')
  })
})
