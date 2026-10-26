import type { PermissionOption, RequestPermissionRequest, RequestPermissionResponse, ToolKind } from '@agentclientprotocol/sdk'
import type { PermissionPolicy } from '../../shared/types.ts'
import type { AdapterHost } from '../types/index.ts'
import { PLUGIN_ID } from '../../shared/constants.ts'

export interface PermissionTurn {
  dshSessionId: string | undefined
  signal: AbortSignal | undefined
}

const READ_ONLY_KINDS: ReadonlySet<ToolKind> = new Set(['read', 'search', 'think', 'fetch'])

function pick(options: readonly PermissionOption[], kinds: readonly PermissionOption['kind'][]): PermissionOption | undefined {
  for (const kind of kinds) {
    const option = options.find(entry => entry.kind === kind)
    if (option !== undefined)
      return option
  }
  return undefined
}

function allow(request: RequestPermissionRequest): RequestPermissionResponse {
  const option = pick(request.options, ['allow_once', 'allow_always'])
  return option === undefined ? reject(request) : { outcome: { outcome: 'selected', optionId: option.optionId } }
}

function reject(request: RequestPermissionRequest): RequestPermissionResponse {
  const option = pick(request.options, ['reject_once', 'reject_always'])
  return option === undefined ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId: option.optionId } }
}

function readOnly(request: RequestPermissionRequest): RequestPermissionResponse {
  const kind = request.toolCall.kind ?? 'other'
  return READ_ONLY_KINDS.has(kind) ? allow(request) : reject(request)
}

/**
 * Classify the response dsh gave for one ACP permission request.
 * @param request - the original request with its offered options.
 * @param response - the ACP response returned to the agent.
 * @returns the display outcome matching the selected option, or `cancelled` when none was selected.
 */
export function permissionOutcome(
  request: RequestPermissionRequest,
  response: RequestPermissionResponse,
): 'allowed' | 'rejected' | 'cancelled' {
  const outcome = response.outcome
  if (outcome.outcome !== 'selected') return 'cancelled'
  const option = request.options.find(entry => entry.optionId === outcome.optionId)
  return option?.kind.startsWith('allow') === true ? 'allowed' : 'rejected'
}

export async function decidePermission(
  host: AdapterHost,
  route: string,
  policy: PermissionPolicy,
  turn: PermissionTurn | undefined,
  request: RequestPermissionRequest,
): Promise<RequestPermissionResponse> {
  switch (policy) {
    case 'allow':
      return allow(request)
    case 'reject':
      return reject(request)
    case 'read-only':
      return readOnly(request)
    case 'ask':
      break
  }
  const agent = turn?.dshSessionId === undefined ? undefined : host.agentOf(turn.dshSessionId)
  if (agent === undefined || host.approve === undefined) {
    host.logger.warn(`${PLUGIN_ID}: no approval answerer for ACP agent "${route}"; falling back to read-only permission`)
    return readOnly(request)
  }
  const kind = request.toolCall.kind ?? 'other'
  const title = request.toolCall.title ?? kind
  try {
    const outcome = await host.approve({
      agent,
      toolName: `${route} · ${kind}`,
      reason: title,
      ...turn?.signal === undefined ? {} : { signal: turn.signal },
    })
    return outcome === 'allowed-once' ? allow(request) : reject(request)
  }
  catch (error) {
    host.logger.warn(`${PLUGIN_ID}: approval for ACP agent "${route}" failed; rejecting`, error)
    return reject(request)
  }
}
