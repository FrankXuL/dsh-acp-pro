/**
 * Conversation Definitions for ACP execution records. Each record carries a complete
 * snapshot, so a Definition renders from its earliest loaded event without earlier pages.
 */

import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  AcpPermissionOptionRecord, AcpPermissionRecord, AcpPermissionStatus, AcpPlanRecord, AcpToolCallRecord,
  AcpToolContentView, AcpToolLocation, AcpToolStatus,
} from '../../shared/records.ts'
import { ACP_PERMISSION_EVENT, ACP_PLAN_EVENT, ACP_TOOL_CALL_EVENT } from '../../shared/records.ts'

/** Renderer payload for one ACP tool call. */
export interface AcpToolCallViewData {
  readonly title: string
  readonly kind: string | null
  readonly status: AcpToolStatus
  readonly content: readonly AcpToolContentView[]
  readonly locations: readonly AcpToolLocation[]
  readonly input: string | null
  readonly output: string | null
  readonly startedAt: number
  readonly updatedAt: number
}

/** Renderer payload for one ACP plan. */
export interface AcpPlanViewData {
  readonly entries: readonly { readonly content: string, readonly status: string, readonly priority: string | null }[]
  readonly updatedAt: number
}

/** Renderer payload for one ACP permission request. */
export interface AcpPermissionViewData {
  readonly runId: string
  readonly requestId: string
  readonly callId: string | null
  readonly title: string
  readonly kind: string | null
  readonly options: readonly AcpPermissionOptionRecord[]
  readonly status: AcpPermissionStatus
  readonly createdAt: number
  readonly updatedAt: number
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** One external ACP agent tool call. */
    'acp-tool-call': AcpToolCallViewData
    /** One external ACP agent plan. */
    'acp-plan': AcpPlanViewData
    /** One external ACP agent permission request, display-only in this version. */
    'acp-permission': AcpPermissionViewData
  }
}

function toolCallView(record: AcpToolCallRecord): AcpToolCallViewData {
  return {
    title: record.title,
    kind: record.kind,
    status: record.status,
    content: record.content,
    locations: record.locations,
    input: record.input,
    output: record.output,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
  }
}

function planView(record: AcpPlanRecord): AcpPlanViewData {
  return { entries: record.entries, updatedAt: record.updatedAt }
}

function permissionView(record: AcpPermissionRecord): AcpPermissionViewData {
  return {
    runId: record.runId,
    requestId: record.requestId,
    callId: record.callId,
    title: record.title,
    kind: record.kind,
    options: record.options,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Fold every tool-call snapshot for one call into its keyed Chat node. */
export const acpToolCallDefinition: ConversationNodeDefinition<AcpToolCallRecord> = {
  kind: 'acp-tool-call',
  target: 'chat',
  match: (event) => {
    const type: string = event.type
    if (type !== ACP_TOOL_CALL_EVENT) return null
    const data = event.data as AcpToolCallRecord
    return { id: `${data.runId}:${data.callId}`, role: data.phase }
  },
  start: (_context, match) => match.event.data as AcpToolCallRecord,
  update: (_context, match) => match.event.data as AcpToolCallRecord,
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined) return null
    return {
      key: context.key,
      kind: 'acp-tool-call',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data: toolCallView(context.state as AcpToolCallRecord),
    }
  },
}

/** Fold every plan snapshot for one ACP turn into its keyed Chat node. */
export const acpPlanDefinition: ConversationNodeDefinition<AcpPlanRecord> = {
  kind: 'acp-plan',
  target: 'chat',
  match: (event) => {
    const type: string = event.type
    if (type !== ACP_PLAN_EVENT) return null
    const data = event.data as AcpPlanRecord
    return { id: data.runId, role: data.phase }
  },
  start: (_context, match) => match.event.data as AcpPlanRecord,
  update: (_context, match) => match.event.data as AcpPlanRecord,
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined) return null
    return {
      key: context.key,
      kind: 'acp-plan',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data: planView(context.state as AcpPlanRecord),
    }
  },
}

/**
 * Fold every permission-request snapshot for one request into its keyed Chat node.
 * The first record is the `start` snapshot and every later record is a complete
 * `update` snapshot, so the Definition never accumulates deltas across events.
 */
export const acpPermissionDefinition: ConversationNodeDefinition<AcpPermissionRecord> = {
  kind: 'acp-permission',
  target: 'chat',
  match: (event) => {
    const type: string = event.type
    if (type !== ACP_PERMISSION_EVENT) return null
    const data = event.data as AcpPermissionRecord
    return { id: `${data.runId}:${data.requestId}`, role: data.phase }
  },
  start: (_context, match) => match.event.data as AcpPermissionRecord,
  update: (_context, match) => match.event.data as AcpPermissionRecord,
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined) return null
    return {
      key: context.key,
      kind: 'acp-permission',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: context.start.location,
      visibility: 'visible',
      data: permissionView(context.state as AcpPermissionRecord),
    }
  },
}
