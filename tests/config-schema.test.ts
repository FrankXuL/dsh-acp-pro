import type { Volatile } from '@deepseek-ai/cosmokit'
import { describe, expect, it } from 'vitest'
import { agentsOf, Config } from '../src/host/config/schema.ts'

/** The model picker needs per-route enablement, a route icon and cross-device favorites. */

function resolve(config: unknown): Config {
  return Config(config as never) as unknown as Config
}

describe('ACP agent profile schema', () => {
  it('defaults enabled to true so existing profiles keep registering', () => {
    const config = resolve({ agents: { cc: { command: '/bin/true' } } })
    expect(agentsOf(config).cc?.enabled).toBe(true)
  })

  it('reads a disabled route without weakening the command requirement', () => {
    const config = resolve({ agents: { cc: { command: '/bin/true', enabled: false } } })
    expect(agentsOf(config).cc?.enabled).toBe(false)
    // Disabling is not a draft state: a route still needs a command line.
    expect(() => resolve({ agents: { cc: { enabled: false } } })).toThrow()
  })

  it('keeps an optional icon that the picker can resolve later', () => {
    expect(agentsOf(resolve({ agents: { cc: { command: '/bin/true', icon: 'claude' } } })).cc?.icon).toBe('claude')
    expect(agentsOf(resolve({ agents: { cc: { command: '/bin/true' } } })).cc?.icon).toBeUndefined()
  })
})

describe('favorites', () => {
  it('defaults to an empty list', () => {
    const config = resolve({ agents: {} })
    expect((config.favorites as unknown as Volatile<unknown[]>).get()).toEqual([])
  })

  it('is volatile so a settings edit hot-swaps instead of remounting the plugin', () => {
    const config = resolve({ agents: {}, favorites: [{ provider: 'cc', model: 'opus' }] })
    const favorites = config.favorites as unknown as Volatile<{ provider: string, model: string }[]>
    expect(typeof favorites.get).toBe('function')
    expect(favorites.get()).toEqual([{ provider: 'cc', model: 'opus' }])
  })

  it('requires both provider and model on each entry', () => {
    expect(() => resolve({ agents: {}, favorites: [{ provider: 'cc' }] })).toThrow()
  })
})
