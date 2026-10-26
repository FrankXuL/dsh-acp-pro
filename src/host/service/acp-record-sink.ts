/**
 * Turns ACP stream updates into durable plugin records so the Web Client can render the
 * external agent's execution. Recording failures never affect the model turn.
 */

import type { ContentBlock, PlanEntry, RequestPermissionRequest, SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk'
import type { Session } from '@deepseek-ai/dsh-session'
import type { AcpRecordSink, HostLogger } from '../types/index.ts'
import type {
  AcpPermissionOptionRecord, AcpPermissionRecord, AcpPermissionStatus, AcpPlanEntryRecord, AcpPlanRecord,
  AcpToolCallRecord, AcpToolContentView, AcpToolLocation, AcpToolStatus,
} from '../../shared/records.ts'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { ACP_PERMISSION_EVENT, ACP_PLAN_EVENT, ACP_TOOL_CALL_EVENT } from '../../shared/records.ts'

/** Maximum stored chars for one text content block. */
const MAX_TEXT = 8_000

/** Maximum stored chars for one diff side. */
const MAX_DIFF = 20_000

/** Maximum stored chars for one raw input/output snapshot. */
const MAX_RAW = 4_000

type AcpRecordMap = {
  'plugin:acp/tool-call': AcpToolCallRecord
  'plugin:acp/plan': AcpPlanRecord
  'plugin:acp/permission': AcpPermissionRecord
}

interface ToolState {
  readonly callId: string
  readonly startedAt: number
  title: string
  kind: string | null
  status: AcpToolStatus
  content: readonly AcpToolContentView[]
  locations: readonly AcpToolLocation[]
  input: string | null
  output: string | null
  started: boolean
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… (${text.length - limit} chars omitted)`
}

/** Stringify an ACP raw value without letting an exotic payload break the turn. */
function rawText(value: unknown): string | null {
  if (value === undefined || value === null)
    return null
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return typeof text === 'string' ? clip(text, MAX_RAW) : null
  }
  catch {
    return null
  }
}

function normalizeBlock(block: ContentBlock): AcpToolContentView | undefined {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: clip(block.text, MAX_TEXT) }
    case 'image':
      return { type: 'image', mediaType: block.mimeType, bytes: block.data.length }
    case 'resource_link':
      return { type: 'link', name: block.name, uri: block.uri }
    case 'resource': {
      const resource = block.resource
      return 'text' in resource && typeof resource.text === 'string'
        ? { type: 'text', text: clip(resource.text, MAX_TEXT) }
        : undefined
    }
    default:
      return undefined
  }
}

/** Normalize one ACP content collection into bounded display blocks. */
function normalizeContent(content: readonly ToolCallContent[] | null | undefined): AcpToolContentView[] {
  if (content === null || content === undefined)
    return []
  const blocks: AcpToolContentView[] = []
  for (const item of content) {
    if (item.type === 'content') {
      const block = normalizeBlock(item.content)
      if (block !== undefined)
        blocks.push(block)
    }
    else if (item.type === 'diff') {
      blocks.push({
        type: 'diff',
        path: item.path,
        oldText: item.oldText === null || item.oldText === undefined ? null : clip(item.oldText, MAX_DIFF),
        newText: clip(item.newText, MAX_DIFF),
      })
    }
    else {
      blocks.push({ type: 'terminal', terminalId: item.terminalId })
    }
  }
  return blocks
}

function normalizeLocations(locations: readonly { path: string, line?: number | null }[] | null | undefined): AcpToolLocation[] {
  if (locations === null || locations === undefined)
    return []
  return locations.map(location => location.line === null || location.line === undefined
    ? { path: location.path }
    : { path: location.path, line: location.line })
}

function planStatus(status: string): AcpPlanEntryRecord['status'] {
  switch (status) {
    case 'in_progress': return 'in_progress'
    case 'completed': return 'completed'
    case 'cancelled': return 'cancelled'
    default: return 'pending'
  }
}

function planEntries(entries: readonly PlanEntry[]): AcpPlanEntryRecord[] {
  return entries.map(entry => ({
    content: clip(entry.content, MAX_TEXT),
    status: planStatus(entry.status),
    priority: entry.priority ?? null,
  }))
}

/**
 * Create the recorder for one model turn.
 * @param session - the DSH Session receiving records; absent when none can be resolved.
 * @param logger - Host logger for a contained recording failure.
 * @returns the sink, or undefined when the turn has no durable Session to record into.
 */
export function createAcpRecordSink(session: Session | undefined, logger: HostLogger): AcpRecordSink | undefined {
  if (session === undefined)
    return undefined
  const runId = crypto.randomUUID()
  const tools = new Map<string, ToolState>()
  let planStarted = false
  let disabled = false

  const append = <K extends keyof AcpRecordMap>(type: K, data: AcpRecordMap[K]): void => {
    if (disabled)
      return
    try {
      appendPluginRecord(session, type, data)
    }
    catch (error: unknown) {
      disabled = true
      logger.warn(`dsh-acp-pro: disabled ACP execution records after a refused append`, error)
    }
  }

  const permissionOptions = (request: RequestPermissionRequest): AcpPermissionOptionRecord[] => request.options.map(option => ({
    id: option.optionId,
    label: option.name,
    kind: option.kind,
  }))

  const recordTool = (state: ToolState, phase: 'start' | 'update'): void => {
    append(ACP_TOOL_CALL_EVENT, {
      phase,
      runId,
      callId: state.callId,
      title: state.title,
      kind: state.kind,
      status: state.status,
      content: state.content,
      locations: state.locations,
      input: state.input,
      output: state.output,
      startedAt: state.startedAt,
      updatedAt: Date.now(),
    })
  }

  return {
    push(update: SessionUpdate): void {
      switch (update.sessionUpdate) {
        case 'tool_call': {
          const state: ToolState = {
            callId: update.toolCallId,
            startedAt: Date.now(),
            title: update.title,
            kind: update.kind ?? null,
            status: update.status ?? 'pending',
            content: normalizeContent(update.content),
            locations: normalizeLocations(update.locations),
            input: rawText(update.rawInput),
            output: rawText(update.rawOutput),
            started: false,
          }
          tools.set(state.callId, state)
          state.started = true
          recordTool(state, 'start')
          break
        }
        case 'tool_call_update': {
          const state = tools.get(update.toolCallId) ?? {
            callId: update.toolCallId,
            startedAt: Date.now(),
            title: update.toolCallId,
            kind: null,
            status: 'pending' as AcpToolStatus,
            content: [],
            locations: [],
            input: null,
            output: null,
            started: false,
          }
          state.title = update.title ?? state.title
          state.kind = update.kind ?? state.kind
          state.status = update.status ?? state.status
          if (update.content !== undefined && update.content !== null)
            state.content = normalizeContent(update.content)
          if (update.locations !== undefined && update.locations !== null)
            state.locations = normalizeLocations(update.locations)
          state.input = update.rawInput === undefined ? state.input : rawText(update.rawInput)
          state.output = update.rawOutput === undefined ? state.output : rawText(update.rawOutput)
          tools.set(state.callId, state)
          recordTool(state, state.started ? 'update' : 'start')
          state.started = true
          break
        }
        case 'plan': {
          append(ACP_PLAN_EVENT, {
            phase: planStarted ? 'update' : 'start',
            runId,
            entries: planEntries(update.entries),
            updatedAt: Date.now(),
          })
          planStarted = true
          break
        }
        default:
          break
      }
    },
    permission(request: RequestPermissionRequest): (outcome: AcpPermissionStatus) => void {
      const requestId = crypto.randomUUID()
      const createdAt = Date.now()
      const toolCall = request.toolCall
      const evidence = {
        runId,
        requestId,
        callId: toolCall.toolCallId ?? null,
        title: toolCall.title ?? toolCall.toolCallId ?? 'permission',
        kind: toolCall.kind ?? null,
        options: permissionOptions(request),
        createdAt,
      }
      append(ACP_PERMISSION_EVENT, { phase: 'start', ...evidence, status: 'pending', updatedAt: createdAt })
      return (outcome: AcpPermissionStatus): void => {
        append(ACP_PERMISSION_EVENT, { phase: 'update', ...evidence, status: outcome, updatedAt: Date.now() })
      }
    },
  }
}
