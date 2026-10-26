import type { JsonValue, SettingsPathOpView } from '../types/runtime.ts'
import type { AgentImport, AgentImportEntry, AgentImportIssue, AgentRow } from './agents.types.ts'
import { ROUTE_PATTERN } from '../constants/index.ts'

/**
 * Import of agent server lists written for other ACP clients: Zed's `agent_servers`
 * (also `agentServers`), this plugin's own `agents` section, or a bare
 * `{ name: { command, args, env } }` map.
 */

type JsonObject = Record<string, JsonValue>

/** Fields an import owns; anything else on an existing route (permission, models, …) is kept. */
const IMPORTED_KEYS = ['displayName', 'command', 'args', 'env'] as const

const LIST_KEYS = ['agent_servers', 'agentServers', 'agents'] as const

function objectOf(value: JsonValue | undefined): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

/** Turn a client-side display name into a route id; empty for names with no ASCII letters or digits. */
export function routeOf(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-._]+|[-._]+$/g, '')
}

/** The server map and whether its keys are already route ids (this plugin's own `agents`). */
function serversOf(document: JsonObject): { servers: JsonObject, routed: boolean } {
  for (const key of LIST_KEYS) {
    const list = objectOf(document[key])
    if (list !== undefined)
      return { servers: list, routed: key === 'agents' }
  }
  return { servers: document, routed: false }
}

function entryOf(name: string, value: JsonValue | undefined): { ok: true, command: string, args: string[], env: Record<string, string>, displayName?: string } | { ok: false, reason: AgentImportIssue['reason'] } {
  const server = objectOf(value)
  const command = server?.command
  if (server === undefined || typeof command !== 'string' || command.trim().length === 0)
    return { ok: false, reason: 'importMissingCommand' }
  const args = server.args ?? []
  if (!Array.isArray(args) || !args.every(arg => typeof arg === 'string'))
    return { ok: false, reason: 'importBadArgs' }
  const env = server.env ?? {}
  const envObject = objectOf(env)
  if (envObject === undefined || !Object.values(envObject).every(item => typeof item === 'string'))
    return { ok: false, reason: 'importBadEnv' }
  const displayName = typeof server.displayName === 'string' ? server.displayName : name
  return { ok: true, command: command.trim(), args: args as string[], env: envObject as Record<string, string>, displayName }
}

/**
 * Parse pasted JSON into importable agents. Routes are derived from the entry names and
 * de-duplicated within the import; a route that already exists is marked as a replacement.
 */
export function parseAgentImport(text: string, rows: readonly AgentRow[]): AgentImport {
  let document: JsonValue
  try {
    document = JSON.parse(text) as JsonValue
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  const root = objectOf(document)
  if (root === undefined)
    return { ok: false, error: 'expected a JSON object' }

  const existing = new Map(rows.map(row => [row.route, row]))
  const taken = new Set<string>()
  const entries: AgentImportEntry[] = []
  const skipped: AgentImportIssue[] = []
  const { servers, routed } = serversOf(root)
  for (const [name, value] of Object.entries(servers)) {
    const parsed = entryOf(name, value)
    if (!parsed.ok) {
      skipped.push({ name, reason: parsed.reason })
      continue
    }
    const stem = routed && ROUTE_PATTERN.test(name) ? name : routeOf(name) || 'agent'
    let route = stem
    for (let suffix = 2; taken.has(route); suffix++)
      route = `${stem}-${suffix}`
    taken.add(route)
    const previous = existing.get(route)
    const carried = Object.fromEntries(Object.entries(previous?.user ?? {}).filter(([key]) => !(IMPORTED_KEYS as readonly string[]).includes(key)))
    const profile: JsonObject = {
      ...previous === undefined ? { permission: 'ask' } : carried,
      ...parsed.displayName === undefined || parsed.displayName === route ? {} : { displayName: parsed.displayName },
      command: parsed.command,
      ...parsed.args.length > 0 ? { args: parsed.args } : {},
      ...Object.keys(parsed.env).length > 0 ? { env: parsed.env } : {},
    }
    entries.push({ name, route, replaces: previous !== undefined, profile })
  }
  return { ok: true, entries, skipped }
}

/** One atomic write storing every imported agent. */
export function importOpsOf(entries: readonly AgentImportEntry[]): SettingsPathOpView[] {
  return entries.map(entry => ({ op: 'set', path: ['agents', entry.route], value: entry.profile }))
}
