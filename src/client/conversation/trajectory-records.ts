/**
 * The ACP tool call as it appears in the native Trajectory view.
 *
 * The Chat view already renders these records as cards. The Trajectory view is a second consumer
 * of the same log-only records, so it gets its own Definitions rather than a shared one: a
 * Definition declares exactly one target, and these records are worth seeing in both.
 *
 * What this deliberately is not: a native tool card. ACP tools are real work performed by an
 * external agent, not calls this harness dispatched, so the node is an "unknown surface" carrying
 * the ACP record — labelled as such — instead of a fabricated tool-call block. The trajectory
 * fold accepts external nodes only through its `node` channel, and that is what this uses.
 */

import type { ConversationNodeDefinition, ConversationNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TrajectoryConversationViewNode } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { AcpToolCallRecord } from '../../shared/records.ts'
import { ACP_TOOL_CALL_EVENT } from '../../shared/records.ts'

/** Node type string carried inside the trajectory node; also what a reader keys on. */
export const ACP_TRAJECTORY_TOOL_TYPE = 'acp-tool-call'

/**
 * Payload of one ACP tool call as the trajectory row shows it.
 *
 * Kept flat and already-truncated by the producer, like the Chat card's payload: the fold renders
 * from any single record without earlier ones.
 */
export interface AcpTrajectoryToolData {
  readonly title: string
  readonly kind: string | null
  readonly status: string
  readonly startedAt: number
  readonly updatedAt: number
  /** One-line summary of the agent's raw input, when it supplied one. */
  readonly input: string | null
  /** One-line summary of the agent's raw output, when it supplied one. */
  readonly output: string | null
  readonly locations: readonly { readonly path: string, readonly line?: number }[]
}

/** Project one record onto the row payload. */
export function trajectoryToolData(record: AcpToolCallRecord): AcpTrajectoryToolData {
  return {
    title: record.title,
    kind: record.kind,
    status: record.status,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    input: record.input,
    output: record.output,
    locations: record.locations.map(location => ({
      path: location.path,
      ...location.line === undefined ? {} : { line: location.line },
    })),
  }
}

/**
 * Wrap one projection in the Trajectory target envelope.
 *
 * Written inline rather than imported: the upstream helper lives in an internal module outside the
 * package's stable export surface. The envelope is seven fields, and the fold validates exactly two
 * of them — `key` must equal the Definition's context key, `target` must equal the building target.
 */
function trajectoryNode(
  key: string,
  kind: string,
  id: string,
  anchorSeq: number,
  location: TrajectoryConversationViewNode['location'],
  data: AcpTrajectoryToolData,
): TrajectoryConversationViewNode {
  const node: ConversationNode = {
    kind: 'unknown',
    seq: anchorSeq,
    time: Date.now(),
    type: ACP_TRAJECTORY_TOOL_TYPE,
    data,
  }
  return {
    key,
    kind,
    id,
    target: 'trajectory',
    anchorSeq,
    location,
    data: { kind: 'node', node },
  } as TrajectoryConversationViewNode
}

/**
 * Fold every ACP tool-call snapshot for one call into a single Trajectory row.
 *
 * Identity matches the Chat card's (`runId:callId`) because it is the same underlying call — the
 * two targets simply keep independent state for it.
 */
export const acpTrajectoryToolCallDefinition: ConversationNodeDefinition<AcpToolCallRecord> = {
  kind: 'acp-tool-call-trajectory',
  target: 'trajectory',
  match: (event) => {
    const type: string = event.type
    if (type !== ACP_TOOL_CALL_EVENT)
      return null
    const data = event.data as AcpToolCallRecord
    return { id: `${data.runId}:${data.callId}`, role: data.phase }
  },
  start: (_context, match) => match.event.data as AcpToolCallRecord,
  update: (_context, match) => match.event.data as AcpToolCallRecord,
  buildViewNode: (context) => {
    if (context.start === undefined)
      return null
    return trajectoryNode(
      context.key,
      context.kind,
      context.id,
      context.start.event.seq,
      context.start.location,
      trajectoryToolData(context.state as AcpToolCallRecord),
    )
  },
}
