/**
 * Source classification for the model picker's icon rail: which configured ACP routes exist,
 * in what order, and which glyph each one renders. The rail only ever shows sources that
 * actually have a provider group in the catalog; this module decides the identity and order.
 */
import type { ConfigFormSnapshot, JsonValue } from '../types/runtime.ts'

export interface AgentProfileView {
  displayName?: string
  icon?: string
  enabled?: boolean
}

/** Configured agents from the settings document, disabled routes excluded. */
export function agentProfilesOf(snapshot: Pick<ConfigFormSnapshot, 'value'> | undefined): Record<string, AgentProfileView> {
  const value = snapshot?.value
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {}
  const agents = (value as Record<string, JsonValue>).agents
  if (typeof agents !== 'object' || agents === null || Array.isArray(agents))
    return {}
  const out: Record<string, AgentProfileView> = {}
  for (const [route, raw] of Object.entries(agents as Record<string, JsonValue>)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      continue
    const profile = raw as Record<string, JsonValue>
    out[route] = {
      ...typeof profile.displayName === 'string' ? { displayName: profile.displayName } : {},
      ...typeof profile.icon === 'string' ? { icon: profile.icon } : {},
      ...typeof profile.enabled === 'boolean' ? { enabled: profile.enabled } : {},
    }
  }
  return out
}

/**
 * Routes that may appear on the rail: enabled only, ordered by display name then route so a
 * config key rename or a YAML reorder never reshuffles the user's familiar rail.
 */
export function sourceRoutes(snapshot: Pick<ConfigFormSnapshot, 'value'> | undefined): string[] {
  return Object.entries(agentProfilesOf(snapshot))
    .filter(([, profile]) => profile.enabled !== false)
    .sort(([leftRoute, left], [rightRoute, right]) => {
      const byName = (left.displayName ?? leftRoute).localeCompare(right.displayName ?? rightRoute)
      return byName !== 0 ? byName : leftRoute.localeCompare(rightRoute)
    })
    .map(([route]) => route)
}

/** Built-in icon names the picker can draw itself. */
export const BUILTIN_ICONS = ['claude', 'codex', 'gemini', 'deepseek', 'openai', 'opencode', 'cursor', 'grok', 'pi', 'hermes', 'devin', 'antigravity'] as const

export type BuiltinIcon = typeof BUILTIN_ICONS[number]

export type SourceIcon
  = | { kind: 'builtin', name: BuiltinIcon }
    | { kind: 'emoji', text: string }
    | { kind: 'url', url: string }
    | { kind: 'letter', text: string }

const URL_PATTERN = /^(https?:\/\/|\/\/|\.{0,2}\/)/i

/**
 * Names that carry a recognizable product behind them (only those with a bundled mark). Each entry is matched against the lower
 * cased display name as a whole word so "OpenCode" hits `opencode` while a plain "Code" or
 * "Antigravity" does not get a wrong glyph.
 */
const NAME_HINTS: readonly { name: BuiltinIcon, pattern: RegExp }[] = [
  { name: 'claude', pattern: /claude/ },
  { name: 'codex', pattern: /codex/ },
  { name: 'gemini', pattern: /gemini/ },
  { name: 'deepseek', pattern: /deep\.?seek/ },
  { name: 'openai', pattern: /openai|open ai|\bgpt\b|chatgpt/ },
  { name: 'opencode', pattern: /opencode|open code/ },
  { name: 'antigravity', pattern: /antigravity|anti gravity/ },
  { name: 'cursor', pattern: /\bcursor\b/ },
  { name: 'grok', pattern: /\bgrok\b/ },
  { name: 'pi', pattern: /^\s*pi\s*$/ },
  { name: 'hermes', pattern: /hermes/ },
  { name: 'devin', pattern: /devin/ },
]

function builtinFromName(displayName: string): BuiltinIcon | undefined {
  const lower = displayName.toLowerCase()
  return NAME_HINTS.find(hint => hint.pattern.test(lower))?.name
}

/**
 * Pick the glyph for one source, in order of authority:
 * 1. an explicit `icon` (built-in name, emoji, or image URL);
 * 2. a built-in icon implied by the display name (Claude Code → claude, OpenCode → opencode);
 * 3. the display name's initial.
 * Anything unrecognized degrades to the initial rather than failing.
 */
export function resolveSourceIcon(profile: AgentProfileView, route = ''): SourceIcon {
  const icon = profile.icon?.trim()
  if (icon !== undefined && icon.length > 0) {
    const builtin = BUILTIN_ICONS.find(name => name === icon.toLowerCase())
    if (builtin !== undefined)
      return { kind: 'builtin', name: builtin }
    if (URL_PATTERN.test(icon))
      return { kind: 'url', url: icon }
    if (!/^[\w-]+$/.test(icon))
      return { kind: 'emoji', text: icon }
  }
  const label = (profile.displayName ?? route).trim()
  const hinted = label.length > 0 ? builtinFromName(label) : undefined
  if (hinted !== undefined)
    return { kind: 'builtin', name: hinted }
  return { kind: 'letter', text: label.length === 0 ? '?' : label[0]!.toUpperCase() }
}
