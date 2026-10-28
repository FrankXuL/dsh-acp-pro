/**
 * The persisted binding contract and its translation to and from the in-memory binding.
 *
 * A binding is the per-`(route, conversation)` state that lets an ACP session be reused across
 * turns and lets an uncertain turn refuse replay after a restart. Only the durable minimum lives
 * here; live handles (the ACP session, the listener, the persist queue) stay in memory.
 *
 * Kept free of host services and of the adapter so the translation can be tested directly.
 */

import type { Usage } from '@agentclientprotocol/sdk'

/** ACP turn state as the conversation panel sees it. */
export type BindingTurnState = 'idle' | 'running' | 'unknown'

/** A prompt that was submitted but whose result was never established. */
export interface AcpPendingTurn {
  id: string
  messageIds: string[]
}

/** Durable minimum needed to reconnect or prevent an uncertain prompt from replaying. */
export interface AcpBindingRecord {
  version: 1
  provider: string
  dshSessionId: string
  acpSessionId?: string
  cwd: string
  protocolVersion: number
  spawnFactsHash: string
  model: string
  usage?: Usage
  consumedIds: string[]
  replayBarrierIds: string[]
  needsFreshInput: boolean
  revision: number
  pending?: AcpPendingTurn
}

/** The persisted shape's own guard, used when reading a file that may have been edited. */
export function isBindingRecord(value: unknown): value is AcpBindingRecord {
  if (typeof value !== 'object' || value === null)
    return false
  const record = value as Partial<AcpBindingRecord>
  return record.version === 1
    && typeof record.provider === 'string'
    && typeof record.dshSessionId === 'string'
    && typeof record.cwd === 'string'
    && typeof record.protocolVersion === 'number'
    && typeof record.spawnFactsHash === 'string'
    && typeof record.model === 'string'
    && (record.usage === undefined || (typeof record.usage === 'object' && record.usage !== null))
    && Array.isArray(record.consumedIds)
    && record.consumedIds.every(id => typeof id === 'string')
    && Array.isArray(record.replayBarrierIds)
    && record.replayBarrierIds.every(id => typeof id === 'string')
    && typeof record.needsFreshInput === 'boolean'
    && typeof record.revision === 'number'
    && Number.isSafeInteger(record.revision)
    && record.revision >= 0
    && (record.acpSessionId === undefined || typeof record.acpSessionId === 'string')
    && (record.pending === undefined
      || (typeof record.pending === 'object' && record.pending !== null
        && typeof record.pending.id === 'string'
        && Array.isArray(record.pending.messageIds)
        && record.pending.messageIds.every(id => typeof id === 'string')))
}

/**
 * A conversation-scoped binding, as the adapter holds it.
 *
 * `recovery` records whether the ACP session was reattached (`loaded`) or freshly opened (`new`);
 * it decides whether the first turn's usage figure is trustworthy.
 */
export interface BindingState {
  provider: string
  dshSessionId: string | undefined
  /** Live ACP session id, once one exists; persisted so a restart can attempt a reload. */
  acpSessionId?: string
  cwd: string
  model: string
  consumed: string[]
  usage: Usage | undefined
  settingsRevision: number
  protocolVersion: number
  spawnFactsHash: string
  replayBarrierIds: string[]
  needsFreshInput: boolean
  pending?: AcpPendingTurn
  turnState: BindingTurnState
  revision: number
  recovery: 'new' | 'loaded'
}

/**
 * Translate the live binding into its durable record.
 *
 * Returns `undefined` for ephemeral work: a turn without a conversation id owns no durable
 * state, so persisting it would create a record nothing can ever reload.
 *
 * @param binding - the live binding.
 * @param live - facts only the live ACP session knows, when one exists.
 * @returns the record to persist, or `undefined` when this binding is not durable.
 */
export function bindingRecordOf(
  binding: BindingState,
  live?: { sessionId?: string, protocolVersion?: number },
): AcpBindingRecord | undefined {
  const dshSessionId = binding.dshSessionId
  if (dshSessionId === undefined)
    return undefined
  const acpSessionId = live?.sessionId ?? binding.acpSessionId
  return {
    version: 1,
    provider: binding.provider,
    dshSessionId,
    ...acpSessionId === undefined ? {} : { acpSessionId },
    cwd: binding.cwd,
    protocolVersion: live?.protocolVersion ?? binding.protocolVersion,
    spawnFactsHash: binding.spawnFactsHash,
    model: binding.model,
    ...binding.usage === undefined ? {} : { usage: binding.usage },
    consumedIds: [...binding.consumed],
    replayBarrierIds: [...binding.replayBarrierIds],
    needsFreshInput: binding.needsFreshInput,
    revision: binding.revision,
    ...binding.pending === undefined
      ? {}
      : { pending: { id: binding.pending.id, messageIds: [...binding.pending.messageIds] } },
  }
}

/**
 * Rebuild the durable half of a live binding from its stored record.
 *
 * The caller supplies the live-only slots (session, listener, persist queue) afterwards; this
 * function only restores state that must survive a restart.
 *
 * @param record - a record previously produced by {@link bindingRecordOf}.
 * @returns the restored binding state, with `recovery` marked `loaded`.
 */
export function bindingFromRecord(record: AcpBindingRecord): BindingState {
  return {
    provider: record.provider,
    dshSessionId: record.dshSessionId,
    acpSessionId: record.acpSessionId,
    cwd: record.cwd,
    model: record.model,
    consumed: [...record.consumedIds],
    usage: record.usage,
    settingsRevision: 0,
    protocolVersion: record.protocolVersion,
    spawnFactsHash: record.spawnFactsHash,
    replayBarrierIds: [...record.replayBarrierIds],
    needsFreshInput: record.needsFreshInput,
    pending: record.pending === undefined
      ? undefined
      : { id: record.pending.id, messageIds: [...record.pending.messageIds] },
    // A restored record that still carries a pending turn has an unknown result by definition:
    // the previous process died before that prompt settled, so the turn must not be replayed.
    turnState: record.pending === undefined ? 'idle' : 'unknown',
    revision: record.revision,
    // Restoring the record does not reattach the ACP session; the caller attempts a load and
    // only marks this `loaded` once the agent confirms it. Until then the recovery is `new`.
    recovery: 'new',
  }
}
