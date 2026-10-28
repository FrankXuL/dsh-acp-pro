import type { ConfigFormSnapshot } from '../src/client/types/runtime.ts'
import { describe, expect, it } from 'vitest'
import { favoriteKey, favoritesOf, toggleFavoriteOps } from '../src/client/service/favorites.ts'

function snapshot(value: unknown): ConfigFormSnapshot {
  return { status: 'ready', value: value as never, base: undefined, user: undefined, revision: 3, writable: true, mode: 'host' }
}

describe('favorites projection', () => {
  it('reads the configured list from the settings snapshot', () => {
    const favorites = favoritesOf(snapshot({ agents: {}, favorites: [{ provider: 'cc', model: 'opus' }] }))
    expect(favorites).toEqual([{ provider: 'cc', model: 'opus' }])
  })

  it('treats a missing or malformed list as empty', () => {
    expect(favoritesOf(snapshot({ agents: {} }))).toEqual([])
    expect(favoritesOf(snapshot({ agents: {}, favorites: 'nope' }))).toEqual([])
    expect(favoritesOf(snapshot({ agents: {}, favorites: [{ provider: 'cc' }] }))).toEqual([])
  })

  it('identifies an entry by provider and model together', () => {
    expect(favoriteKey('cc', 'opus')).not.toBe(favoriteKey('cc', 'sonnet'))
    expect(favoriteKey('cc', 'opus')).not.toBe(favoriteKey('codex', 'opus'))
  })
})

describe('toggleFavoriteOps', () => {
  it('appends a new favorite as a whole-array replacement of the settings path', () => {
    const ops = toggleFavoriteOps([], 'cc', 'opus')
    expect(ops).toEqual([{ op: 'set', path: ['favorites'], value: [{ provider: 'cc', model: 'opus' }] }])
  })

  it('prepends so the newest favorite reads first inside its source group', () => {
    const ops = toggleFavoriteOps([{ provider: 'cc', model: 'sonnet' }], 'cc', 'opus')
    expect(ops).toEqual([{
      op: 'set',
      path: ['favorites'],
      value: [{ provider: 'cc', model: 'opus' }, { provider: 'cc', model: 'sonnet' }],
    }])
  })

  it('removes an existing favorite without touching other sources', () => {
    const ops = toggleFavoriteOps([
      { provider: 'cc', model: 'opus' },
      { provider: 'codex', model: 'gpt-5' },
    ], 'cc', 'opus')
    expect(ops).toEqual([{ op: 'set', path: ['favorites'], value: [{ provider: 'codex', model: 'gpt-5' }] }])
  })
})
