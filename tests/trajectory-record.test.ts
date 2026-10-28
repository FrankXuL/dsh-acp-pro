/**
 * The ACP tool call's Trajectory Definition: which records it claims, what it produces, and the
 * envelope rules the engine enforces.
 */

import type { AcpToolCallRecord } from '../src/shared/records.ts'
import { describe, expect, it } from 'vitest'
import {
  ACP_TRAJECTORY_TOOL_TYPE,
  acpTrajectoryToolCallDefinition,
  trajectoryToolData,
} from '../src/client/conversation/trajectory-records.ts'
import { ACP_TOOL_CALL_EVENT } from '../src/shared/records.ts'

function record(overrides: Partial<AcpToolCallRecord> = {}): AcpToolCallRecord {
  return {
    phase: 'start',
    runId: 'run-1',
    callId: 'call-1',
    title: 'Edit source',
    kind: 'edit',
    status: 'pending',
    content: [],
    locations: [{ path: '/w/a.ts', line: 4 }],
    input: '{"path":"/w/a.ts"}',
    output: null,
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_100,
    ...overrides,
  }
}

/** Minimal stand-in for the engine's match event. */
function event(data: unknown, seq = 7): never {
  return { type: ACP_TOOL_CALL_EVENT, seq, data } as never
}

describe('trajectory tool-call Definition', () => {
  it('targets the trajectory view, not chat', () => {
    expect(acpTrajectoryToolCallDefinition.target).toBe('trajectory')
  })

  it('uses a kind of its own so chat and trajectory registrations cannot collide', () => {
    // The engine throws on a duplicate Definition kind across the whole registries.
    expect(acpTrajectoryToolCallDefinition.kind).not.toBe('acp-tool-call')
    expect(acpTrajectoryToolCallDefinition.kind).not.toBe('acp-plan')
    expect(acpTrajectoryToolCallDefinition.kind).not.toBe('acp-permission')
  })

  it('claims ACP tool-call records and nothing else', () => {
    expect(acpTrajectoryToolCallDefinition.match(event(record()))).toEqual({
      id: 'run-1:call-1',
      role: 'start',
    })
    expect(acpTrajectoryToolCallDefinition.match({ type: 'plugin:acp/plan', seq: 1, data: {} } as never)).toBeNull()
    expect(acpTrajectoryToolCallDefinition.match({ type: 'tool/call', seq: 1, data: {} } as never)).toBeNull()
  })

  it('keeps one row per call by using the same identity as the chat card', () => {
    const start = acpTrajectoryToolCallDefinition.match(event(record({ phase: 'start' })))
    const update = acpTrajectoryToolCallDefinition.match(event(record({ phase: 'update' })))
    expect(start?.id).toBe(update?.id)
    expect(start?.role).toBe('start')
    expect(update?.role).toBe('update')
  })

  it('builds a node whose key and target satisfy the engine checks', () => {
    const context = {
      key: '5:acp-tool-callopaque',
      kind: 'acp-tool-call-trajectory',
      id: 'run-1:call-1',
      state: record(),
      start: { event: { seq: 12 }, location: { kind: 'session' } },
    } as never
    const node = acpTrajectoryToolCallDefinition.buildViewNode!(context)!

    // The fold rejects a node whose key differs from its context, or whose target differs from
    // the one being built.
    const envelope = node as unknown as { key: string, target: string, anchorSeq: number }
    expect(envelope.key).toBe('5:acp-tool-callopaque')
    expect(envelope.target).toBe('trajectory')
    expect(envelope.anchorSeq).toBe(12)
  })

  it('carries the record as an unknown-surface node, never as a native tool call', () => {
    const context = {
      key: 'k',
      kind: 'acp-tool-call-trajectory',
      id: 'run-1:call-1',
      state: record(),
      start: { event: { seq: 3 }, location: { kind: 'session' } },
    } as never
    const node = acpTrajectoryToolCallDefinition.buildViewNode!(context)!
    const contribution = node.data as { kind: string, node: { kind: string, type: string } }

    // A fabricated `tool-call` block would claim the harness dispatched this work itself.
    expect(contribution.kind).toBe('node')
    expect(contribution.node.kind).toBe('unknown')
    expect(contribution.node.type).toBe(ACP_TRAJECTORY_TOOL_TYPE)
  })

  it('produces nothing before the first record arrives', () => {
    const context = {
      key: 'k',
      kind: 'acp-tool-call-trajectory',
      id: 'run-1:call-1',
      state: undefined,
      start: undefined,
    } as never
    expect(acpTrajectoryToolCallDefinition.buildViewNode!(context)).toBeNull()
  })
})

describe('trajectory row payload', () => {
  it('projects the fields a row shows without transformations', () => {
    const data = trajectoryToolData(record({ status: 'completed', output: 'ok' }))
    expect(data).toMatchObject({
      title: 'Edit source',
      kind: 'edit',
      status: 'completed',
      input: '{"path":"/w/a.ts"}',
      output: 'ok',
    })
  })

  it('keeps location lines only when the agent supplied one', () => {
    const data = trajectoryToolData(record({ locations: [{ path: '/w/a.ts' }, { path: '/w/b.ts', line: 9 }] }))
    expect(data.locations).toEqual([{ path: '/w/a.ts' }, { path: '/w/b.ts', line: 9 }])
  })
})
