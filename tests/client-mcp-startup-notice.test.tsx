// @vitest-environment happy-dom

/**
 * A codex-acp by-name MCP skip arrives through the failed-tool channel, so the row must be
 * recognized by its notice text and rendered as "not started" rather than an error. A real
 * startup failure keeps the error row, so the two paths are pinned side by side.
 */

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AcpToolCallNode, type AcpToolCallNodeProps } from '../src/client/components/record-nodes.tsx'
import type { AcpToolCallViewData } from '../src/client/conversation/records.ts'
import { isSkippedMcpStartup } from '../src/client/lib/mcp-startup-notice.ts'
import { zh } from '../src/client/locales/index.ts'

const LOCATION = { kind: 'session' } as const

const SKIP_TEXT = '[codex-acp] MCP server `context-mode` was not started, because the Codex config '
  + 'already defines an MCP server with this name. Codex uses its own entry, or no server if that entry is disabled.'
const FAIL_TEXT = '[codex-acp forwarded startup error] MCP server `context-mode` failed to start: ENOENT'

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

const dictionary: Record<string, string> = zh
const t = ((key: string, params?: Record<string, string | number>) =>
  (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => (
    params !== undefined && name in params ? String(params[name]) : match
  ))) as unknown as AcpToolCallNodeProps['t']

function viewData(overrides: Partial<AcpToolCallViewData> = {}): AcpToolCallViewData {
  return {
    title: 'mcp__context-mode__startup',
    kind: 'other',
    status: 'failed',
    content: [{ type: 'text', text: SKIP_TEXT }],
    locations: [],
    input: null,
    output: null,
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_500,
    ...overrides,
  }
}

function props(data: AcpToolCallViewData): AcpToolCallNodeProps {
  return {
    node: {
      key: 'acp-tool-call:run-1:call-1',
      kind: 'acp-tool-call',
      id: 'run-1:call-1',
      target: 'chat',
      anchorSeq: 7,
      location: LOCATION,
      visibility: 'visible',
      data,
    },
    openFile: vi.fn(),
    t,
  } as unknown as AcpToolCallNodeProps
}

describe('mcp startup skip notice', () => {
  it('recognizes the skip wording only', () => {
    expect(isSkippedMcpStartup(viewData())).toBe(true)
    expect(isSkippedMcpStartup(viewData({ content: [{ type: 'text', text: FAIL_TEXT }] }))).toBe(false)
    expect(isSkippedMcpStartup(viewData({ status: 'completed' }))).toBe(false)
    expect(isSkippedMcpStartup(viewData({ title: 'ctx_execute_file' }))).toBe(false)
    expect(isSkippedMcpStartup(viewData({ kind: 'execute' }))).toBe(false)
  })

  it('renders a skip as not started and keeps a real failure as an alert', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(createElement(AcpToolCallNode, props(viewData()))))
      expect(container.querySelector('.dap-rec')?.getAttribute('data-status')).toBe('skipped')
      const skipped = container.querySelector('.dap-rec-status')!
      expect(skipped.textContent).toBe(zh['status.skipped'])
      expect(skipped.getAttribute('role')).toBeNull()

      await act(async () => root.render(createElement(AcpToolCallNode, props(
        viewData({ content: [{ type: 'text', text: FAIL_TEXT }] }),
      ))))
      expect(container.querySelector('.dap-rec')?.getAttribute('data-status')).toBe('failed')
      const failed = container.querySelector('.dap-rec-status')!
      expect(failed.textContent).toBe(zh['status.failed'])
      expect(failed.getAttribute('role')).toBe('alert')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('falls back to the failure row when upstream rewrites the notice', async () => {
    // The anchor is wording. A reworded skip must degrade to the honest failure row, never be swallowed.
    const reworded = viewData({ content: [{ type: 'text', text: '[codex-acp] MCP server `context-mode` was skipped.' }] })
    expect(isSkippedMcpStartup(reworded)).toBe(false)

    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(AcpToolCallNode, props(reworded))))
      expect(container.querySelector('.dap-rec')?.getAttribute('data-status')).toBe('failed')
      expect(container.querySelector('.dap-rec-status')?.getAttribute('role')).toBe('alert')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
