import type { AcpAgentProfile, AcpModelProfile, ImageInputMode, PermissionPolicy } from '../../shared/types.ts'
import type { ConfigForm, JsonValue, LlmDiscoveredModel, LlmRemote } from '../types/runtime.ts'

/** One configured ACP agent as the settings page lists it. */
export interface AgentRow {
  route: string
  /** Schema-resolved profile (defaults filled in). */
  profile: AcpAgentProfile
  /** Raw user-layer profile, when the user settings section declares this route. */
  user: Record<string, JsonValue> | undefined
  /** Whether the composition base (profile YAML) declares this route; such routes cannot be deleted here. */
  inherited: boolean
}

/** The plugin's settings section projected for the page. */
export interface AgentsSnapshot {
  writable: boolean
  rows: AgentRow[]
}

/** Form state of the agent editor; list-valued fields are edited as one-per-line text. */
export interface AgentDraft {
  /** Route being edited, or `null` for a new agent. */
  originalRoute: string | null
  route: string
  displayName: string
  command: string
  args: string
  env: string
  authMethod: string
  permission: PermissionPolicy
  imageInput: ImageInputMode
  models: AcpModelProfile[]
}

/** Localized validation failure; `key` names a locale entry. */
export interface DraftIssue {
  key: 'routeRequired' | 'routeInvalid' | 'routeTaken' | 'commandRequired' | 'envInvalid' | 'modelIdRequired' | 'modelIdDuplicate'
  params?: Record<string, string | number>
}

export type DraftValidation
  = | { ok: true, route: string, profile: Record<string, JsonValue> }
    | { ok: false, issue: DraftIssue }

export interface SaveAgentInput {
  form: ConfigForm
  originalRoute: string | null
  route: string
  profile: Record<string, JsonValue>
}

export interface RemoveAgentInput {
  form: ConfigForm
  route: string
}

export interface DiscoverAgentModelsInput {
  llm: LlmRemote
  route: string
}

export interface AgentActionResult {
  ok: boolean
  /** Transport or Host failure message; absent when the settings service refused the write. */
  error?: string
}

export interface DiscoverAgentModelsResult extends AgentActionResult {
  models?: LlmDiscoveredModel[]
}

/** One agent parsed from pasted client configuration. */
export interface AgentImportEntry {
  /** Name as written in the source configuration. */
  name: string
  route: string
  /** Whether a configured route of the same id is overwritten (its other fields are kept). */
  replaces: boolean
  profile: Record<string, JsonValue>
}

export interface AgentImportIssue {
  name: string
  reason: 'importMissingCommand' | 'importBadArgs' | 'importBadEnv'
}

export type AgentImport
  = | { ok: true, entries: AgentImportEntry[], skipped: AgentImportIssue[] }
    | { ok: false, error: string }

export interface ImportAgentsInput {
  form: ConfigForm
  entries: readonly AgentImportEntry[]
}
