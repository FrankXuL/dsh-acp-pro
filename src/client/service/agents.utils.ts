import type { AcpAgentProfile, AcpModelProfile } from '../../shared/types.ts'
import type { ConfigFormSnapshot, JsonValue, LlmDiscoveredModel, SettingsPathOpView } from '../types/runtime.ts'
import type { AgentDraft, AgentRow, AgentsSnapshot, DraftValidation } from './agents.types.ts'
import { ROUTE_PATTERN } from '../constants/index.ts'

/** Profile keys the editor owns; everything else in a stored profile is carried over untouched. */
const EDITED_KEYS = ['displayName', 'command', 'args', 'env', 'authMethod', 'permission', 'imageInput', 'models'] as const

type JsonObject = Record<string, JsonValue>

function objectOf(value: JsonValue | undefined): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function agentsOf(section: unknown): JsonObject {
  return objectOf(objectOf(section as JsonValue | undefined)?.agents) ?? {}
}

function stringArrayOf(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function stringRecordOf(value: JsonValue | undefined): Record<string, string> {
  const entries = Object.entries(objectOf(value) ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return Object.fromEntries(entries)
}

function modelsOf(value: JsonValue | undefined): AcpModelProfile[] {
  if (!Array.isArray(value))
    return []
  return value.flatMap((item) => {
    const model = objectOf(item)
    if (model === undefined || typeof model.id !== 'string')
      return []
    return [{
      id: model.id,
      ...typeof model.name === 'string' ? { name: model.name } : {},
      ...typeof model.description === 'string' ? { description: model.description } : {},
      ...typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {},
    }]
  })
}

/** Read one resolved profile defensively; the Host already applied schema defaults. */
function profileOf(raw: JsonObject): AcpAgentProfile {
  const permission = raw.permission
  const imageInput = raw.imageInput
  return {
    ...typeof raw.displayName === 'string' ? { displayName: raw.displayName } : {},
    command: typeof raw.command === 'string' ? raw.command : '',
    args: stringArrayOf(raw.args),
    env: stringRecordOf(raw.env),
    ...typeof raw.cwd === 'string' ? { cwd: raw.cwd } : {},
    ...typeof raw.authMethod === 'string' ? { authMethod: raw.authMethod } : {},
    models: modelsOf(raw.models),
    discoverModels: raw.discoverModels !== false,
    permission: permission === 'allow' || permission === 'read-only' || permission === 'reject' ? permission : 'ask',
    imageInput: imageInput === 'force' || imageInput === 'off' ? imageInput : 'auto',
    systemPrompt: raw.systemPrompt === 'forward' ? 'forward' : 'drop',
    showToolCalls: raw.showToolCalls !== false,
    contextWindow: typeof raw.contextWindow === 'number' ? raw.contextWindow : 0,
    startupTimeoutMs: typeof raw.startupTimeoutMs === 'number' ? raw.startupTimeoutMs : 0,
    idleTimeoutMs: typeof raw.idleTimeoutMs === 'number' ? raw.idleTimeoutMs : 0,
  }
}

/** Project the plugin's settings form into the rows the page renders. */
export function snapshotOf(form: Pick<ConfigFormSnapshot, 'value' | 'user' | 'base' | 'writable'>): AgentsSnapshot {
  const resolved = agentsOf(form.value)
  const user = agentsOf(form.user)
  const base = agentsOf(form.base)
  const rows: AgentRow[] = Object.entries(resolved).flatMap(([route, value]) => {
    const raw = objectOf(value)
    if (raw === undefined)
      return []
    return [{ route, profile: profileOf(raw), user: objectOf(user[route]), inherited: route in base }]
  })
  return { writable: form.writable, rows }
}

export function formatArgs(args: readonly string[]): string {
  return args.join('\n')
}

export function formatEnv(env: Readonly<Record<string, string>>): string {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n')
}

export function parseArgs(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
}

/** Parse `KEY=VALUE` lines; returns the 1-based number of the first malformed line on failure. */
export function parseEnv(text: string): { ok: true, env: Record<string, string> } | { ok: false, line: number } {
  const env: Record<string, string> = {}
  const lines = text.split('\n')
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    if (line.length === 0)
      continue
    const separator = line.indexOf('=')
    const key = separator === -1 ? '' : line.slice(0, separator).trim()
    if (key.length === 0)
      return { ok: false, line: index + 1 }
    env[key] = line.slice(separator + 1)
  }
  return { ok: true, env }
}

export function emptyDraft(): AgentDraft {
  return { originalRoute: null, route: '', displayName: '', command: '', args: '', env: '', authMethod: '', permission: 'ask', imageInput: 'auto', models: [] }
}

export function draftOf(row: AgentRow): AgentDraft {
  const { profile } = row
  return {
    originalRoute: row.route,
    route: row.route,
    displayName: profile.displayName ?? '',
    command: profile.command,
    args: formatArgs(profile.args),
    env: formatEnv(profile.env),
    authMethod: profile.authMethod ?? '',
    permission: profile.permission,
    imageInput: profile.imageInput,
    models: profile.models.map(model => ({ ...model })),
  }
}

function modelJson(model: AcpModelProfile): JsonObject {
  const name = model.name?.trim() ?? ''
  return {
    id: model.id.trim(),
    ...name.length > 0 ? { name } : {},
    ...model.description === undefined ? {} : { description: model.description },
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
  }
}

/**
 * Validate a draft and build the profile to store. Fields the editor does not show are
 * carried over from the route's user-layer profile so saving never drops them.
 */
export function validateDraft(draft: AgentDraft, rows: readonly AgentRow[]): DraftValidation {
  const route = draft.route.trim()
  if (route.length === 0)
    return { ok: false, issue: { key: 'routeRequired' } }
  if (!ROUTE_PATTERN.test(route))
    return { ok: false, issue: { key: 'routeInvalid' } }
  if (route !== draft.originalRoute && rows.some(row => row.route === route))
    return { ok: false, issue: { key: 'routeTaken', params: { route } } }
  const command = draft.command.trim()
  if (command.length === 0)
    return { ok: false, issue: { key: 'commandRequired' } }
  const env = parseEnv(draft.env)
  if (!env.ok)
    return { ok: false, issue: { key: 'envInvalid', params: { line: env.line } } }
  const seen = new Set<string>()
  for (const model of draft.models) {
    const id = model.id.trim()
    if (id.length === 0)
      return { ok: false, issue: { key: 'modelIdRequired' } }
    if (seen.has(id))
      return { ok: false, issue: { key: 'modelIdDuplicate', params: { id } } }
    seen.add(id)
  }

  const previous = rows.find(row => row.route === draft.originalRoute)?.user ?? {}
  const carried = Object.fromEntries(Object.entries(previous).filter(([key]) => !(EDITED_KEYS as readonly string[]).includes(key)))
  const displayName = draft.displayName.trim()
  const authMethod = draft.authMethod.trim()
  const args = parseArgs(draft.args)
  const profile: JsonObject = {
    ...carried,
    ...displayName.length > 0 ? { displayName } : {},
    command,
    ...args.length > 0 ? { args } : {},
    ...Object.keys(env.env).length > 0 ? { env: env.env } : {},
    ...authMethod.length > 0 ? { authMethod } : {},
    permission: draft.permission,
    ...draft.imageInput === 'auto' ? {} : { imageInput: draft.imageInput },
    ...draft.models.length > 0 ? { models: draft.models.map(modelJson) } : {},
  }
  return { ok: true, route, profile }
}

/** Ops that store one agent, moving it when the route was renamed. */
export function saveOpsOf(originalRoute: string | null, route: string, profile: JsonObject): SettingsPathOpView[] {
  const ops: SettingsPathOpView[] = []
  if (originalRoute !== null && originalRoute !== route)
    ops.push({ op: 'unset', path: ['agents', originalRoute] })
  ops.push({ op: 'set', path: ['agents', route], value: profile })
  return ops
}

export function removeOpsOf(route: string): SettingsPathOpView[] {
  return [{ op: 'unset', path: ['agents', route] }]
}

/** Append discovered models the draft does not list yet, keeping the user's rows and order. */
export function mergeDiscovered(models: readonly AcpModelProfile[], discovered: readonly LlmDiscoveredModel[]): AcpModelProfile[] {
  const known = new Set(models.map(model => model.id.trim()))
  const added = discovered
    .filter(model => !known.has(model.id))
    .map(model => ({ id: model.id, ...model.name === undefined || model.name === model.id ? {} : { name: model.name } }))
  return [...models, ...added]
}
