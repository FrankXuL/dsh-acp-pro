/**
 * Decides whether a turn changes the source that owns a conversation, and what to tell the user
 * when it does.
 *
 * A conversation is executed by one source at a time: the platform's own providers, or one
 * configured ACP route. Staying inside that source — a different model, a different reasoning
 * effort — costs nothing. Crossing to another source does: the ACP session that held the work so
 * far is rebuilt, the history is handed over as flattened text, and the previous source's tool
 * execution stays invisible to the new one.
 *
 * This module only names that boundary. Whether to ask, and how, belongs to the caller: the
 * Host asks through the native approval surface when one exists; otherwise it proceeds with a
 * note. Keeping the rule pure makes it testable without a host or a process.
 */

/** What a conversation is executed by: the platform, or one ACP route. */
export type ExecutionSource = string

/** The platform's own providers share one source; plugin routes are their own source. */
export const PLATFORM_SOURCE: ExecutionSource = 'platform'

/** Remembered decisions, so a repeated crossing in one conversation asks only once per pair. */
export interface CrossSourceMemory {
  /** Keys already confirmed, shaped `from→to`. */
  readonly confirmed: ReadonlySet<string>
}

/** One decision about a turn's source relative to the conversation's owner. */
export type CrossSourceVerdict =
  /** Same source: nothing to say. */
  | { readonly kind: 'same-source' }
  /** The conversation has no owner yet, so this turn establishes one. */
  | { readonly kind: 'first-turn', readonly source: ExecutionSource }
  /** A crossing the user already confirmed for this conversation. */
  | { readonly kind: 'confirmed', readonly from: ExecutionSource, readonly to: ExecutionSource }
  /** A crossing that still needs the user's answer. */
  | { readonly kind: 'needs-confirmation', readonly from: ExecutionSource, readonly to: ExecutionSource }

/** Key under which one crossing pair is remembered. */
export function crossingKey(from: ExecutionSource, to: ExecutionSource): string {
  return `${from}\u2192${to}`
}

/**
 * Classify one turn against the conversation's current owner.
 *
 * @param owner - the source that has been executing this conversation, if any.
 * @param next - the source this turn would use.
 * @param memory - crossings already confirmed for this conversation.
 * @returns what the caller should do about it.
 */
export function classifySourceChange(
  owner: ExecutionSource | undefined,
  next: ExecutionSource,
  memory: CrossSourceMemory,
): CrossSourceVerdict {
  if (owner === undefined)
    return { kind: 'first-turn', source: next }
  if (owner === next)
    return { kind: 'same-source' }
  if (memory.confirmed.has(crossingKey(owner, next)))
    return { kind: 'confirmed', from: owner, to: next }
  return { kind: 'needs-confirmation', from: owner, to: next }
}

/** The three facts a crossing warning must state, in the user's language. */
export interface CrossSourceWarning {
  readonly from: ExecutionSource
  readonly to: ExecutionSource
  /** The prior source's in-process session is discarded and rebuilt. */
  readonly rebuildsSession: true
  /** History is handed over as flattened text, not as native state. */
  readonly flattensHistory: true
  /** The prior source's tool execution does not enter the new source's context. */
  readonly hidesPreviousTools: true
}

/**
 * Build the warning payload for a crossing.
 *
 * @param verdict - a `needs-confirmation` verdict.
 * @returns the facts to render, or `undefined` for any other verdict.
 */
export function warningFor(verdict: CrossSourceVerdict): CrossSourceWarning | undefined {
  return verdict.kind === 'needs-confirmation'
    ? {
      from: verdict.from,
      to: verdict.to,
      rebuildsSession: true,
      flattensHistory: true,
      hidesPreviousTools: true,
    }
    : undefined
}

/**
 * Map an approval answer onto a decision.
 *
 * `unavailable` means the host has no approval surface, and `cancelled` means the surface was
 * dismissed without an answer. Neither is a refusal by the user, so both proceed: refusing here
 * would make the feature silently unfireable in exactly the configurations that need it most
 * (fully-permissive sessions, headless hosts).
 *
 * @param outcome - what the approval surface reported.
 * @returns whether the crossing may proceed, and whether to tell the user instead of asking.
 */
export function decideFromApproval(outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'): {
  proceed: boolean
  notifyOnly: boolean
} {
  switch (outcome) {
    case 'allowed-once':
      return { proceed: true, notifyOnly: false }
    case 'rejected':
      return { proceed: false, notifyOnly: false }
    case 'cancelled':
    case 'unavailable':
      return { proceed: true, notifyOnly: true }
  }
}
