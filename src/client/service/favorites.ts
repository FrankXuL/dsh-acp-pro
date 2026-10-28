/**
 * Favorites live in the plugin's settings document (`favorites`), not in browser storage:
 * the DSH web origin changes port on every launch, so localStorage would not survive a restart.
 * Writes go through the same `ConfigForm.mutate()` the settings page uses — no new Host RPC.
 */
import type {
  AcpModelFavorite, ConfigFormSnapshot, JsonValue, SettingsPathOpView,
} from '../types/runtime.ts'

export const FAVORITES_PATH = ['favorites'] as const

function listOf(value: JsonValue | undefined): AcpModelFavorite[] {
  if (!Array.isArray(value))
    return []
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      return []
    const { provider, model } = item as Record<string, JsonValue>
    return typeof provider === 'string' && typeof model === 'string' ? [{ provider, model }] : []
  })
}

/** Favorited models as saved in the settings document; malformed entries are ignored. */
export function favoritesOf(snapshot: Pick<ConfigFormSnapshot, 'value'>): AcpModelFavorite[] {
  const value = snapshot.value
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return []
  return listOf((value as Record<string, JsonValue>).favorites)
}

/** Stable identity for one favorited model; provider and model only, never availability. */
export function favoriteKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

/**
 * Ops for starring/unstarring one model. The whole array is replaced in a single `set`, so two
 * rapid clicks can never leave a half-written list behind.
 */
export function toggleFavoriteOps(
  current: readonly AcpModelFavorite[],
  provider: string,
  model: string,
): SettingsPathOpView[] {
  const key = favoriteKey(provider, model)
  const without = current.filter(item => favoriteKey(item.provider, item.model) !== key)
  const next = without.length === current.length
    ? [{ provider, model }, ...without]
    : without
  return [{ op: 'set', path: [...FAVORITES_PATH], value: next as unknown as JsonValue }]
}
