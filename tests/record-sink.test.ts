/**
 * ACP execution recorder: one ACP stream update becomes one complete, bounded plugin record.
 * The sink owns the merge semantics (start vs update, snapshot replacement, truncation) and
 * must never let a refused append disturb the model turn.
 */
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { Session } from '@deepseek-ai/dsh-session'
import type { HostLogger } from '../src/host/types/index.ts'
import type { AcpPlanRecord, AcpToolCallRecord, AcpToolContentView } from '../src/shared/records.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-session', () => ({ appendPluginRecord: vi.fn() }))

import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import { createAcpRecordSink } from '../src/host/service/acp-record-sink.ts'
import { ACP_PLAN_EVENT, ACP_TOOL_CALL_EVENT } from '../src/shared/records.ts'

const session = { sessionId: 'sess-1' } as unknown as Session

const append = vi.mocked(appendPluginRecord)

type Appended = [Session, string, AcpToolCallRecord | AcpPlanRecord]

/** The mocked appends, narrowed to the two records this sink writes. */
function appended(): Appended[] {
  return append.mock.calls as unknown as Appended[]
}

function toolRecords(): AcpToolCallRecord[] {
  return appended().filter(([, type]) => type === ACP_TOOL_CALL_EVENT).map(([, , data]) => data as AcpToolCallRecord)
}

function planRecords(): AcpPlanRecord[] {
  return appended().filter(([, type]) => type === ACP_PLAN_EVENT).map(([, , data]) => data as AcpPlanRecord)
}

function makeLogger(): HostLogger {
  return {
    info: vi.fn<(...args: unknown[]) => void>(),
    warn: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
  }
}

function makeSink(logger: HostLogger = makeLogger()): { sink: NonNullable<ReturnType<typeof createAcpRecordSink>>, logger: HostLogger } {
  const sink = createAcpRecordSink(session, logger)
  if (sink === undefined)
    throw new Error('a sink should exist for a durable session')
  return { sink, logger }
}

/** One rich tool_call update: every display field the recorder normalizes. */
function richToolCall(): SessionUpdate {
  return {
    sessionUpdate: 'tool_call',
    toolCallId: 'call-1',
    title: 'Read file',
    kind: 'read',
    status: 'in_progress',
    content: [
      { type: 'content', content: { type: 'text', text: 'first text' } },
      { type: 'content', content: { type: 'image', data: 'aGk=', mimeType: 'image/png' } },
      { type: 'content', content: { type: 'resource_link', name: 'README', uri: 'file:///README.md' } },
    ],
    locations: [{ path: 'src/a.ts', line: 3 }, { path: 'src/b.ts' }],
    rawInput: { path: 'src/a.ts' },
  }
}

beforeEach(() => {
  append.mockReset()
})

describe('acp record sink', () => {
  it('records nothing when the turn has no durable session', () => {
    expect(createAcpRecordSink(undefined, makeLogger())).toBeUndefined()
    expect(append).not.toHaveBeenCalled()
  })

  it('writes one complete start record for a tool_call', () => {
    const { sink, logger } = makeSink()
    sink.push(richToolCall())

    expect(append).toHaveBeenCalledTimes(1)
    const [targetSession, type, data] = appended()[0]!
    expect(targetSession).toBe(session)
    expect(type).toBe(ACP_TOOL_CALL_EVENT)
    expect(data).toMatchObject({
      phase: 'start',
      callId: 'call-1',
      title: 'Read file',
      kind: 'read',
      status: 'in_progress',
      content: [
        { type: 'text', text: 'first text' },
        { type: 'image', mediaType: 'image/png', bytes: 4 },
        { type: 'link', name: 'README', uri: 'file:///README.md' },
      ],
      locations: [{ path: 'src/a.ts', line: 3 }, { path: 'src/b.ts' }],
      input: '{"path":"src/a.ts"}',
      output: null,
    })
    const record = data as AcpToolCallRecord
    expect(record.runId.length).toBeGreaterThan(0)
    expect(record.startedAt).toEqual(expect.any(Number))
    expect(record.updatedAt).toEqual(expect.any(Number))
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('merges tool_call_update as a replace-only snapshot', () => {
    const { sink } = makeSink()
    const startedAt = Date.now()
    sink.push(richToolCall())
    // Content, title and status replace; omitted fields keep their previous value.
    sink.push({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1',
      title: 'Read file (done)',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'final text' } }],
      rawOutput: { ok: true },
    })
    // An update carrying only a status changes nothing else.
    sink.push({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'failed' })
    // An explicit null input clears it; undefined would have kept it.
    sink.push({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', rawInput: null })

    const records = toolRecords()
    expect(records).toHaveLength(4)
    const [start, replaced, statusOnly, cleared] = records
    expect(start!.phase).toBe('start')
    expect(replaced).toMatchObject({
      phase: 'update',
      title: 'Read file (done)',
      kind: 'read',
      status: 'completed',
      // Replaced, not appended: the record is always a complete snapshot.
      content: [{ type: 'text', text: 'final text' }],
      locations: [{ path: 'src/a.ts', line: 3 }, { path: 'src/b.ts' }],
      input: '{"path":"src/a.ts"}',
      output: '{"ok":true}',
      startedAt: start!.startedAt,
      runId: start!.runId,
    })
    expect(replaced!.startedAt).toBeGreaterThanOrEqual(startedAt)
    expect(statusOnly).toMatchObject({ phase: 'update', title: 'Read file (done)', status: 'failed', content: [{ type: 'text', text: 'final text' }] })
    expect(cleared).toMatchObject({ phase: 'update', input: null })
  })

  it('opens a start record for an update naming a tool call it never saw', () => {
    const { sink } = makeSink()
    sink.push({ sessionUpdate: 'tool_call_update', toolCallId: 'ghost-1', status: 'completed' })
    sink.push({ sessionUpdate: 'tool_call_update', toolCallId: 'ghost-1', title: 'Ghost done' })

    const [first, second] = toolRecords()
    expect(first).toMatchObject({
      phase: 'start',
      callId: 'ghost-1',
      title: 'ghost-1',
      kind: null,
      status: 'completed',
      content: [],
      locations: [],
      input: null,
      output: null,
    })
    expect(second).toMatchObject({ phase: 'update', title: 'Ghost done' })
  })

  it('records plan snapshots with start then update phases and normalized entries', () => {
    const { sink } = makeSink()
    sink.push({
      sessionUpdate: 'plan',
      entries: [
        { content: 'inspect the adapter', status: 'in_progress', priority: 'high' },
        { content: 'edit the boundary', status: 'completed', priority: 'low' },
      ],
    })
    sink.push({ sessionUpdate: 'plan', entries: [{ content: 'verify with tests', status: 'pending', priority: 'medium' }] })
    // Out-of-vocabulary status/priority survive as the record vocabulary defines them.
    sink.push({
      sessionUpdate: 'plan',
      entries: [
        { content: 'odd status', status: 'weird' },
        { content: 'cancelled status', status: 'cancelled', priority: 'high' },
      ],
    } as unknown as SessionUpdate)

    const records = planRecords()
    expect(records).toHaveLength(3)
    expect(records[0]).toMatchObject({
      phase: 'start',
      entries: [
        { content: 'inspect the adapter', status: 'in_progress', priority: 'high' },
        { content: 'edit the boundary', status: 'completed', priority: 'low' },
      ],
    })
    expect(records[1]).toMatchObject({ phase: 'update', entries: [{ content: 'verify with tests', status: 'pending', priority: 'medium' }] })
    expect(records[2]).toMatchObject({
      phase: 'update',
      entries: [
        { content: 'odd status', status: 'pending', priority: null },
        { content: 'cancelled status', status: 'cancelled', priority: 'high' },
      ],
    })
    expect(records[0]!.runId).toBe(records[1]!.runId)
    expect(records[0]!.runId.length).toBeGreaterThan(0)
  })

  it('truncates text, diffs and raw payloads at the stored-size limits', () => {
    const { sink } = makeSink()
    const longText = 'x'.repeat(9_000)
    const longOld = 'o'.repeat(25_000)
    const longNew = 'n'.repeat(30_000)
    sink.push({
      sessionUpdate: 'tool_call',
      toolCallId: 'big',
      title: 'Write the whole thing',
      content: [
        { type: 'content', content: { type: 'text', text: longText } },
        { type: 'diff', path: 'src/a.ts', oldText: longOld, newText: longNew },
        { type: 'diff', path: 'src/b.ts', oldText: null, newText: 'short' },
      ],
      rawInput: 'r'.repeat(5_000),
    })

    const views = toolRecords()[0]!.content
    expect(views[0]).toEqual({ type: 'text', text: `${'x'.repeat(8_000)}\n… (1000 chars omitted)` })
    expect(views[1]).toEqual({
      type: 'diff',
      path: 'src/a.ts',
      oldText: `${'o'.repeat(20_000)}\n… (5000 chars omitted)`,
      newText: `${'n'.repeat(20_000)}\n… (10000 chars omitted)`,
    })
    expect(views[2]).toEqual({ type: 'diff', path: 'src/b.ts', oldText: null, newText: 'short' })
    expect(toolRecords()[0]!.input).toBe(`${'r'.repeat(4_000)}\n… (1000 chars omitted)`)
  })

  it('drops content a reader cannot render and keeps a circular raw payload out of the record', () => {
    const { sink } = makeSink()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    sink.push({
      sessionUpdate: 'tool_call',
      toolCallId: 'exotic',
      title: 'Exotic payload',
      content: [
        { type: 'content', content: { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' } },
        { type: 'content', content: { type: 'resource', resource: { uri: 'file:///blob.bin', blob: 'AAAA' } } },
        { type: 'content', content: { type: 'resource', resource: { uri: 'file:///a.txt', text: 'embedded' } } },
        { type: 'terminal', terminalId: 'term-1' },
      ],
      rawInput: circular,
    })

    const record = toolRecords()[0]!
    expect(record.content).toEqual<AcpToolContentView[]>([
      { type: 'text', text: 'embedded' },
      { type: 'terminal', terminalId: 'term-1' },
    ])
    expect(record.input).toBeNull()
  })

  it('silently disables recording once an append is refused', () => {
    const logger = makeLogger()
    const { sink } = makeSink(logger)
    append.mockImplementationOnce(() => {
      throw new Error('session is closed')
    })

    expect(() => sink.push(richToolCall())).not.toThrow()
    expect(append).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const [message, error] = vi.mocked(logger.warn).mock.calls[0]!
    expect(message).toContain('disabled ACP execution records')
    expect(error).toBeInstanceOf(Error)

    // Later updates are dropped without another append attempt and without surfacing the failure.
    expect(() => {
      sink.push({ sessionUpdate: 'plan', entries: [] })
      sink.push(richToolCall())
    }).not.toThrow()
    expect(append).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})
