/**
 * Session records the plugin appends for ACP execution, and the renderer-facing data derived
 * from them. The Host owns production; the Web Client reads the same declarations type-only.
 *
 * These are log-only plugin records (`plugin:` namespace, `ignorable`), so a reader that does
 * not know them skips them and the model-visible surface never changes.
 */

/** Tool-call status values the ACP v1 schema defines. */
export type AcpToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

/** Normalized display content of one tool call, already truncated by the producer. */
export type AcpToolContentView =
  | { readonly type: 'text', readonly text: string }
  | { readonly type: 'diff', readonly path: string, readonly oldText: string | null, readonly newText: string }
  | { readonly type: 'terminal', readonly terminalId: string }
  | { readonly type: 'link', readonly name: string, readonly uri: string }
  | { readonly type: 'image', readonly mediaType: string, readonly bytes: number }

/** One file location a tool call touches. */
export interface AcpToolLocation {
  readonly path: string
  readonly line?: number
}

/**
 * Complete display state of one ACP tool call at append time. Every record carries the whole
 * snapshot, so the client Definition renders from any single record without earlier ones.
 */
export interface AcpToolCallRecord {
  readonly phase: 'start' | 'update'
  /** Per-turn identity; keeps equal ACP call ids from separate turns apart. */
  readonly runId: string
  readonly callId: string
  readonly title: string
  readonly kind: string | null
  readonly status: AcpToolStatus
  readonly content: readonly AcpToolContentView[]
  readonly locations: readonly AcpToolLocation[]
  /** Truncated JSON or text of the agent's raw input, when it supplied one. */
  readonly input: string | null
  /** Truncated JSON or text of the agent's raw output, when it supplied one. */
  readonly output: string | null
  readonly startedAt: number
  readonly updatedAt: number
}

/** One plan entry with the ACP status vocabulary preserved. */
export interface AcpPlanEntryRecord {
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  readonly priority: string | null
}

/** Complete plan state for one ACP turn. */
export interface AcpPlanRecord {
  readonly phase: 'start' | 'update'
  readonly runId: string
  readonly entries: readonly AcpPlanEntryRecord[]
  readonly updatedAt: number
}

/** One option an ACP agent offers for a permission request. */
export interface AcpPermissionOptionRecord {
  readonly id: string
  readonly label: string
  readonly kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

/** Lifecycle of one ACP permission request, settled by DSH's native approval surface. */
export type AcpPermissionStatus = 'pending' | 'allowed' | 'rejected' | 'cancelled'

/**
 * Complete display state of one ACP permission request at append time. The request is
 * answered through DSH's native approval dialog; this record only mirrors it so the Web
 * Client can render a card and, later, correlate the answer.
 */
export interface AcpPermissionRecord {
  readonly phase: 'start' | 'update'
  /** Per-turn identity; keeps equal ACP request ids from separate turns apart. */
  readonly runId: string
  readonly requestId: string
  /** Tool call the request belongs to, when the agent correlated one. */
  readonly callId: string | null
  readonly title: string
  readonly kind: string | null
  readonly options: readonly AcpPermissionOptionRecord[]
  readonly status: AcpPermissionStatus
  readonly createdAt: number
  readonly updatedAt: number
}

/** Record name for one tool-call snapshot. */
export const ACP_TOOL_CALL_EVENT = 'plugin:acp/tool-call'

/** Record name for one plan snapshot. */
export const ACP_PLAN_EVENT = 'plugin:acp/plan'

/** Record name for one permission-request snapshot. */
export const ACP_PERMISSION_EVENT = 'plugin:acp/permission'

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** One ACP tool call, complete at append time. */
    'plugin:acp/tool-call': AcpToolCallRecord
    /** One ACP plan, complete at append time. */
    'plugin:acp/plan': AcpPlanRecord
    /** One ACP permission request, complete at append time. */
    'plugin:acp/permission': AcpPermissionRecord
  }
}
