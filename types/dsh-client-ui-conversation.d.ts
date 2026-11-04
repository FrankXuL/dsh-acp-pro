/**
 * The slice of `@deepseek-ai/dsh-client-ui-conversation` (0.2.1-rc.5) the client and tests use.
 *
 * Platform seed, never installed here (see `dsh-client-ui-slots.d.ts`). Declarations are
 * transcribed from the published `lib/types/client` and limited to the shapes this plugin
 * consumes: the event-to-node fold contract, the location hierarchy, and the composer input
 * facade the session-control panel reads.
 */
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  /** One client-side session event as a Definition's `match` handler receives it. */
  export interface SessionEventLike {
    readonly type: string
    readonly seq: number
    readonly time?: number
    readonly data?: unknown
  }

  /** Engine-owned placement of one matched event in the Session hierarchy. */
  export type ConversationLocation =
    | { readonly kind: 'session' }
    | { readonly kind: 'turn', readonly turn: unknown }
    | { readonly kind: 'step', readonly turn: unknown, readonly step: unknown }
    | { readonly kind: 'unresolved' }

  /** Target-neutral identity returned by a business Definition. */
  export interface ConversationViewNode {
    readonly key: string
    readonly kind: string
    readonly id: string
    readonly target: string
    readonly data: unknown
  }

  /** Definition-local identity; `start` permits initialization when no earlier start is present. */
  export interface ConversationMatchResult {
    readonly id: string
    readonly role: 'start' | 'update'
  }

  /** One event accepted by a Definition, with its lifecycle role and resolved Location. */
  export type ConversationStartMatch = {
    readonly event: SessionEventLike
    readonly role: 'start'
    readonly location: ConversationLocation
  }

  export type ConversationMatch = ConversationStartMatch | {
    readonly event: SessionEventLike
    readonly role: 'update'
    readonly location: ConversationLocation
  }

  /** Evidence currently collected for one Context. */
  export interface ConversationNodeContext<State = unknown> {
    readonly key: string
    readonly kind: string
    readonly id: string
    readonly matches: readonly ConversationMatch[]
    readonly start: ConversationStartMatch | undefined
    readonly state: State | undefined
    readonly current: ReadonlyMap<string, ConversationViewNode | null>
  }

  /** Strictly-backward Context lookup available while a start is evaluated. */
  export interface ConversationContextReader {
    previous<State>(kind: string): unknown
  }

  /** One independently registered business Event-to-Node state machine. */
  export interface ConversationNodeDefinition<State = unknown> {
    readonly kind: string
    /** Sole view target owned by this Definition; omitted for state-only Contexts. */
    readonly target?: string
    match(event: SessionEventLike): ConversationMatchResult | null
    start(context: ConversationNodeContext<State>, match: ConversationStartMatch, reader: ConversationContextReader): State
    update(context: ConversationNodeContext<State> & { readonly state: State }, match: ConversationMatch): State
    buildViewNode?(context: ConversationNodeContext<State>): ConversationViewNode | null
  }

  /** The opacity carrier an external record travels through, never a native tool block. */
  export interface ConversationNode {
    kind: 'unknown'
    seq: number
    time: number
    type: string
    data: unknown
  }

  /** Editor selection and draft revision captured for a revision-guarded insert. */
  export interface TokenSpan {
    readonly start: number
    readonly end: number
    readonly draftRev: number
  }

  /** Imperative composer facade the session-control panel calls. */
  export interface InputActions {
    captureInsertion(): TokenSpan
    insertText(text: string, span: TokenSpan): boolean
    setDraft(text: string): void
    persistDraft(): void
    submit(): void
  }

  /** Published composer state; only the admission phase is read here. */
  export interface InputState {
    readonly draft: string
    readonly draftRev: number
    readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'

  interface SlotMap {
    /** Composer dock: the session-control panel is one entry. */
    'conversation.input.dock': {
      kind: 'list'
      scope: 'session'
      owner: { input: InputState, inputActions: InputActions, sessionId: string }
    }
    /** Model seat: this plugin's picker replaces the shipped entry. */
    'conversation.input.model': {
      kind: 'single'
      scope: 'session'
      owner: { sessionId: string }
    }
    /** Settings section contributed by this plugin. */
    'settings.section': {
      kind: 'list'
      scope: 'root'
      owner: { path?: string[] | undefined }
    }
  }
}
