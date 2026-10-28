/** Settled outcome of one ACP permission request. */
import type { AcpBindingStore } from '../service/session-store.ts'

export type AcpPermissionDecision = 'allowed' | 'rejected' | 'cancelled'

/** One model turn's ACP update recorder, owned by the Host plugin. */
export interface AcpRecordSink {
  /** Record one streamed ACP update; never throws. */
  push: (update: import('@agentclientprotocol/sdk').SessionUpdate) => void
  /**
   * Mirror one permission request as a pending record.
   * @param request - the ACP permission request awaiting an answer.
   * @returns a finisher recording the settled outcome; absent when recording is unavailable.
   */
  permission?: (request: import('@agentclientprotocol/sdk').RequestPermissionRequest) => (outcome: AcpPermissionDecision) => void
}

export interface HostLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export interface HostAgent {
  readonly session: { readonly header: { readonly cwd?: string } }
}

export interface ApprovalRequest {
  agent: HostAgent
  toolName: string
  reason?: string
  signal?: AbortSignal
}

/** One image attachment re-encoded for a model request. */
export interface HostImage {
  data: Uint8Array
  mediaType: string
  width: number
  height: number
}

export interface AdapterHost {
  logger: HostLogger
  /** Durable binding state supplied by the Host; omitted in isolated callers and tests. */
  bindingStore?: AcpBindingStore
  agentOf: (sessionId: string) => HostAgent | undefined
  approve: ((request: ApprovalRequest) => Promise<ApprovalOutcome>) | undefined
  /** Request-sized bytes of one image attachment; absent when no attachment store is mounted. */
  readImage: ((ref: unknown, signal?: AbortSignal) => Promise<HostImage>) | undefined
  /** Start recording one non-ephemeral turn for display; absent when the Host cannot record. */
  startRecording?: (dshSessionId: string | undefined) => AcpRecordSink | undefined
}
