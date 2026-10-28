/**
 * The slice of `@deepseek-ai/dsh-client-ui-trajectory` (0.2.1-rc.2) this plugin's Trajectory
 * Definitions depend on.
 *
 * Like `dsh-client-ui-primitives`, this package is a platform seed: DSH's web module table hands
 * every client bundle the shell's own instance, so it is never installed here. Declarations are
 * transcribed from the published `lib/types` of the upstream checkout, limited to the shape this
 * plugin actually produces.
 *
 * Only types are used. The plugin does not import the package at runtime: it contributes
 * Definitions to a target the host already registers a builder for.
 */
declare module '@deepseek-ai/dsh-client-ui-trajectory/client' {
  import type {
    ConversationLocation,
    ConversationNode,
    ConversationViewNode,
  } from '@deepseek-ai/dsh-client-ui-conversation/client'

  /**
   * One contribution the Trajectory target accepts.
   *
   * This union is closed upstream: a Definition may only produce one of these shapes, and the fold
   * silently ignores kinds it does not recognise. `node` is the only member that carries an
   * arbitrary externally-built node, which is why an ACP record travels through it.
   */
  export type TrajectoryContribution =
    | { readonly kind: 'system-prompt', readonly prompt: unknown }
    | { readonly kind: 'node', readonly node: ConversationNode }
    | { readonly kind: 'assistant', readonly node?: unknown, readonly partial: unknown, readonly request?: unknown }
    | { readonly kind: 'tool', readonly root: unknown }
    | { readonly kind: 'request-header', readonly header: unknown }
    | { readonly kind: 'compaction', readonly request: unknown }
    | { readonly kind: 'session-end', readonly seq: number, readonly time: number }
    | { readonly kind: 'turn-end', readonly turn: number, readonly time: number, readonly error?: string, readonly errorCode?: string }

  /** One materialized Contribution, enveloped for the Trajectory target. */
  export interface TrajectoryConversationViewNode extends ConversationViewNode {
    readonly target: 'trajectory'
    readonly anchorSeq: number
    readonly location: ConversationLocation
    readonly data: TrajectoryContribution
  }
}
