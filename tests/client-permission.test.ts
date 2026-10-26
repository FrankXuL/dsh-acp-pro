/**
 * Folding test for the `acp-permission` Conversation Definition and the display-only card.
 * Permission records are complete snapshots, so driving `match`/`start`/`update` by hand is
 * enough to pin the engine contract: the first record initializes the Context, every later
 * record replaces its State wholesale, and the published Chat node anchors at the start
 * event. The card is rendered statically to pin its copy and its no-button rule.
 */

import type {
  ConversationMatch, ConversationNodeContext, ConversationStartMatch,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AcpPermissionNodeProps } from '../src/client/components/record-nodes.tsx'
import { AcpPermissionNode } from '../src/client/components/record-nodes.tsx'
import { acpPermissionDefinition, type AcpPermissionViewData } from '../src/client/conversation/records.ts'
import { zh } from '../src/client/locales/index.ts'
import type { AcpPermissionOptionRecord, AcpPermissionRecord } from '../src/shared/records.ts'
import { ACP_PERMISSION_EVENT } from '../src/shared/records.ts'

/** One client event as the Definition's `match` handler receives it. */
type ClientEvent = Parameters<typeof acpPermissionDefinition.match>[0]

const LOCATION = { kind: 'session' } as const
const KEY = 'acp-permission:run-1:req-1'

const ALLOW_ONCE: AcpPermissionOptionRecord = { id: 'opt-allow', label: 'Allow', kind: 'allow_once' }
const REJECT_ONCE: AcpPermissionOptionRecord = { id: 'opt-reject', label: 'Reject', kind: 'reject_once' }

function eventAt(seq: number, data: AcpPermissionRecord, type: string = ACP_PERMISSION_EVENT): ClientEvent {
  return {
    type,
    seq,
    time: 1_700_000_000_000 + seq,
    data,
  } as unknown as ClientEvent
}

function record(overrides: Partial<AcpPermissionRecord> = {}): AcpPermissionRecord {
  return {
    phase: 'start',
    runId: 'run-1',
    requestId: 'req-1',
    callId: 'call-1',
    title: 'Run the test suite',
    kind: 'execute',
    options: [ALLOW_ONCE, REJECT_ONCE],
    status: 'pending',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

function context<State extends AcpPermissionRecord | undefined>(
  state: State,
  matches: readonly ConversationMatch[],
  start: ConversationStartMatch | undefined,
): ConversationNodeContext<AcpPermissionRecord> & { readonly state: State } {
  return { key: KEY, kind: 'acp-permission', id: 'run-1:req-1', matches, start, state, current: new Map() }
}

function startMatchOf(event: ClientEvent): ConversationStartMatch {
  return { event, role: 'start', location: LOCATION }
}

function updateMatchOf(event: ClientEvent): ConversationMatch {
  return { event, role: 'update', location: LOCATION }
}

describe('acp-permission Definition', () => {
  it('folds a start snapshot and a later update into one complete view node', () => {
    const startEvent = eventAt(7, record())
    expect(acpPermissionDefinition.match(startEvent)).toEqual({ id: 'run-1:req-1', role: 'start' })
    const startMatch = startMatchOf(startEvent)
    let state = acpPermissionDefinition.start(context(undefined, [startMatch], startMatch), startMatch, {} as never)
    expect(state).toMatchObject({ phase: 'start', status: 'pending', title: 'Run the test suite' })

    const updateRecord = record({ phase: 'update', status: 'allowed', updatedAt: 1_700_000_005_000 })
    const updateEvent = eventAt(11, updateRecord)
    expect(acpPermissionDefinition.match(updateEvent)).toEqual({ id: 'run-1:req-1', role: 'update' })
    const updateMatch = updateMatchOf(updateEvent)
    state = acpPermissionDefinition.update(context(state, [startMatch, updateMatch], startMatch), updateMatch)
    expect(state).toEqual(updateRecord)

    const build = acpPermissionDefinition.buildViewNode
    expect(build).toBeDefined()
    const node = build!(context(state, [startMatch, updateMatch], startMatch))
    expect(node).toMatchObject({
      key: KEY,
      kind: 'acp-permission',
      id: 'run-1:req-1',
      target: 'chat',
      anchorSeq: 7,
      location: LOCATION,
      visibility: 'visible',
    })
    // The update snapshot replaces the start snapshot; nothing is merged incrementally.
    expect(node?.data).toEqual({
      runId: 'run-1',
      requestId: 'req-1',
      callId: 'call-1',
      title: 'Run the test suite',
      kind: 'execute',
      options: [ALLOW_ONCE, REJECT_ONCE],
      status: 'allowed',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_005_000,
    })
  })

  it('keeps equal request ids from different turns apart', () => {
    const first = acpPermissionDefinition.match(eventAt(3, record({ runId: 'run-a' })))
    const second = acpPermissionDefinition.match(eventAt(4, record({ runId: 'run-b' })))
    expect(first?.id).toBe('run-a:req-1')
    expect(second?.id).toBe('run-b:req-1')
    expect(first?.id).not.toBe(second?.id)
  })

  it('ignores other plugin records and publishes nothing without a start', () => {
    expect(acpPermissionDefinition.match(eventAt(5, record(), 'plugin:acp/tool-call'))).toBeNull()
    expect(acpPermissionDefinition.match(eventAt(6, record(), 'plugin:acp/plan'))).toBeNull()
    expect(acpPermissionDefinition.buildViewNode!(context(undefined, [], undefined))).toBeNull()
  })

  it('renders the start snapshot alone and waits for the start of an update-only page', () => {
    // Every record is a complete snapshot, so one start record already publishes a full card.
    const startEvent = eventAt(9, record({ options: [] }))
    const startMatch = startMatchOf(startEvent)
    const state = acpPermissionDefinition.start(context(undefined, [startMatch], startMatch), startMatch, {} as never)
    const node = acpPermissionDefinition.buildViewNode!(context(state, [startMatch], startMatch))
    expect(node).toMatchObject({ anchorSeq: 9 })
    expect(node?.data).toMatchObject({ status: 'pending', options: [] })

    // A page whose earliest loaded record is an update has no start, so nothing is published
    // until the start snapshot enters the window.
    const updateOnly = eventAt(21, record({ phase: 'update', status: 'rejected', options: [REJECT_ONCE] }))
    expect(acpPermissionDefinition.buildViewNode!(context(undefined, [updateMatchOf(updateOnly)], undefined))).toBeNull()
  })
})

/** Chinese lookup mirroring the runtime translator, so the card can be rendered statically. */
const dictionary: Record<string, string> = zh
const t = ((key: string, params?: Record<string, string | number>) =>
  (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => (
    params !== undefined && name in params ? String(params[name]) : match
  ))) as unknown as AcpPermissionNodeProps['t']

function viewData(overrides: Partial<AcpPermissionViewData> = {}): AcpPermissionViewData {
  return {
    runId: 'run-1',
    requestId: 'req-1',
    callId: 'call-1',
    title: 'Run the test suite',
    kind: 'execute',
    options: [ALLOW_ONCE, REJECT_ONCE],
    status: 'pending',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

function renderPermission(overrides: Partial<AcpPermissionViewData> = {}): string {
  const props = {
    node: {
      key: KEY,
      kind: 'acp-permission',
      id: 'run-1:req-1',
      target: 'chat',
      anchorSeq: 7,
      location: LOCATION,
      visibility: 'visible',
      data: viewData(overrides),
    },
    t,
  } as unknown as AcpPermissionNodeProps
  return renderToStaticMarkup(AcpPermissionNode(props))
}

describe('acp-permission card', () => {
  it('renders a pending request as display-only copy without an in-card button', () => {
    const html = renderPermission()
    expect(html).toContain('Run the test suite')
    expect(html).toContain('工具：execute')
    expect(html).toContain('等待答复')
    expect(html).toContain('允许一次')
    expect(html).toContain('Allow')
    expect(html).toContain('仅记录展示，请在原生审批框里答复。')
    expect(html).not.toContain('<button')
  })

  it('renders a resolved request with its own status pill and no display-only hint', () => {
    const html = renderPermission({ status: 'rejected', kind: null })
    expect(html).toContain('已拒绝')
    expect(html).not.toContain('仅记录展示')
    expect(html).not.toContain('工具：execute')
  })

  it('falls back to the localized card title and states that no options were offered', () => {
    const html = renderPermission({ title: '', options: [] })
    expect(html).toContain('<span class="dap-permission-title">权限请求</span>')
    expect(html).toContain('Agent 没有给出可选项。')
  })
})
