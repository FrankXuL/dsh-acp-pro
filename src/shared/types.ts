/** Profile shapes shared by the host schema and the client settings editor. */

export type PermissionPolicy = 'ask' | 'allow' | 'read-only' | 'reject'

export type SystemPromptMode = 'drop' | 'forward'

/**
 * Whether the route offers image input. `auto` follows the `promptCapabilities` the agent
 * declares in its ACP handshake; the other two override an agent that misreports them.
 */
export type ImageInputMode = 'auto' | 'force' | 'off'

export interface AcpModelProfile {
  id: string
  name?: string
  description?: string
  contextWindow?: number
}

export interface AcpAgentProfile {
  displayName?: string
  /** Optional picker icon: a built-in name (`claude`, `codex`, …), an emoji or a URL. */
  icon?: string
  /** Whether this route registers as a provider at all; defaults to `true`. */
  enabled?: boolean
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  authMethod?: string
  models: AcpModelProfile[]
  discoverModels: boolean
  permission: PermissionPolicy
  imageInput: ImageInputMode
  systemPrompt: SystemPromptMode
  showToolCalls: boolean
  /**
   * Offer the MCP servers this host configured to the external agent in `session/new`.
   * Defaults to `true`; `false` starts sessions without them.
   */
  forwardMcp?: boolean
  contextWindow: number
  startupTimeoutMs: number
  idleTimeoutMs: number
}

/** One favorited model in the picker; identity only, never availability. */
export interface AcpModelFavorite {
  provider: string
  model: string
}
