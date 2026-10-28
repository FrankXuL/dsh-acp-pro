import type { Volatile } from '@deepseek-ai/cosmokit'
import type { AcpAgentProfile, AcpModelFavorite, AcpModelProfile } from '../../shared/types.ts'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_CONTEXT_WINDOW } from './constants.ts'

const DEFAULT_IDLE_TIMEOUT_MS = 600_000

const DEFAULT_STARTUP_TIMEOUT_MS = 60_000

export type AgentProfiles = Record<string, AcpAgentProfile>

export interface Config {
  /**
   * Volatile so DSH 0.2 settings serve it as an editable form and commit edits in place
   * (`loader/volatile-update`) instead of restarting the plugin.
   */
  agents: Volatile<AgentProfiles>
  /**
   * Model-picker favorites, keyed by provider/model identity only. Volatile for the same
   * reason as `agents`: starring a model must not remount the plugin. Optional on the input
   * side so existing profile entries that never mention favorites keep type-checking.
   */
  favorites?: Volatile<AcpModelFavorite[]>
}

const AcpModelProfile: z<AcpModelProfile> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.natural(),
})

const AcpAgentProfile: z<AcpAgentProfile> = z.object({
  displayName: z.string(),
  icon: z.string(),
  enabled: z.boolean().default(true),
  command: z.string().required(),
  args: z.array(z.string()).default([]),
  env: z.dict(z.string()).default({}),
  cwd: z.string(),
  authMethod: z.string(),
  models: z.array(AcpModelProfile).default([]),
  discoverModels: z.boolean().default(true),
  permission: z.union(['ask', 'allow', 'read-only', 'reject'] as const).default('ask'),
  imageInput: z.union(['auto', 'force', 'off'] as const).default('auto'),
  systemPrompt: z.union(['drop', 'forward'] as const).default('drop'),
  showToolCalls: z.boolean().default(false),
  forwardMcp: z.boolean().default(true),
  contextWindow: z.natural().default(DEFAULT_CONTEXT_WINDOW),
  startupTimeoutMs: z.natural().default(DEFAULT_STARTUP_TIMEOUT_MS),
  idleTimeoutMs: z.natural().default(DEFAULT_IDLE_TIMEOUT_MS),
})

const AcpModelFavorite: z<AcpModelFavorite> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
})

export const Config: z<{ agents: AgentProfiles, favorites?: AcpModelFavorite[] }, Config> = z.object({
  agents: z.dict(AcpAgentProfile).default({}).volatile(),
  favorites: z.array(AcpModelFavorite).default([]).volatile(),
})

/** Read the agents of a resolved config; a cell from another schemastery copy is read the same way. */
export function agentsOf(config: Pick<Config, 'agents'> | undefined): AgentProfiles {
  const agents = config?.agents as Volatile<AgentProfiles> | AgentProfiles | undefined
  if (agents === undefined)
    return {}
  return typeof agents.get === 'function' ? (agents as Volatile<AgentProfiles>).get() as AgentProfiles : agents as AgentProfiles
}

/** Read the favorites of a resolved config; absent or unwrapped cells read as an empty list. */
export function favoritesOf(config: Pick<Config, 'favorites'> | undefined): readonly AcpModelFavorite[] {
  const favorites = config?.favorites as Volatile<AcpModelFavorite[]> | AcpModelFavorite[] | undefined
  if (favorites === undefined)
    return []
  return typeof (favorites as Volatile<AcpModelFavorite[]>).get === 'function'
    ? (favorites as Volatile<AcpModelFavorite[]>).get()
    : favorites as readonly AcpModelFavorite[]
}
