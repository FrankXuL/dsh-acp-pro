// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AcpToolCallNode, type AcpToolCallNodeProps } from '../src/client/components/record-nodes.tsx'
import type { AcpToolCallViewData } from '../src/client/conversation/records.ts'
import { zh } from '../src/client/locales/index.ts'

const LOCATION = { kind: 'session' } as const

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

/** Chinese lookup mirroring the runtime translator, so the row can be rendered in isolation. */
const dictionary: Record<string, string> = zh
const t = ((key: string, params?: Record<string, string | number>) =>
  (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => (
    params !== undefined && name in params ? String(params[name]) : match
  ))) as unknown as AcpToolCallNodeProps['t']

function viewData(overrides: Partial<AcpToolCallViewData> = {}): AcpToolCallViewData {
  return {
    title: 'Edit source',
    kind: 'edit',
    status: 'completed',
    content: [],
    locations: [],
    input: null,
    output: null,
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_500,
    ...overrides,
  }
}

function props(data: AcpToolCallViewData, openFile = vi.fn()): AcpToolCallNodeProps {
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
    openFile,
    t,
  } as unknown as AcpToolCallNodeProps
}

describe('acp-tool-call row', () => {
  it('shows failure status, a truncated input preview, and complete diff/location details', async () => {
    const openFile = vi.fn()
    const omitted = '\n… (100 chars omitted)'
    const data = viewData({
      status: 'failed',
      content: [{ type: 'diff', path: 'src/a.ts', oldText: 'before\n', newText: 'after\n' }],
      locations: [{ path: 'src/a.ts', line: 12 }, { path: 'src/b.ts' }],
      input: `${'x'.repeat(200)}${omitted}`,
      output: `permission denied${omitted}`,
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(createElement(AcpToolCallNode, props(data, openFile))))
      const toggle = container.querySelector<HTMLButtonElement>('.dap-rec-head')!
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(container.querySelector('.dap-rec-status')?.textContent).toBe(zh['status.failed'])
      expect(container.querySelector('.dap-rec-status')?.getAttribute('role')).toBe('alert')
      expect(container.textContent).toContain('预览已截断')
      expect(container.querySelector('.dap-rec-input-preview-text')?.textContent).toBe('x'.repeat(160))

      await act(async () => toggle.click())
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(container.textContent).toContain('before')
      expect(container.textContent).toContain('after')
      expect(container.textContent).toContain('src/a.ts:12')
      expect(container.textContent).toContain('src/b.ts')
      expect(container.textContent).toContain('100 chars omitted')

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-location-index="0"]')!.click()
      })
      expect(openFile).toHaveBeenCalledWith('src/a.ts', { line: 12 })

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-location-index="1"]')!.click()
      })
      expect(openFile).toHaveBeenCalledWith('src/b.ts')

      await act(async () => {
        container.querySelector<HTMLButtonElement>('.dap-diff-block .dap-file-path')!.click()
      })
      expect(openFile).toHaveBeenCalledWith('src/a.ts')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('keeps pending work labeled and treats older records without content fields as empty detail', async () => {
    const oldData = {
      title: 'Old tool record',
      kind: null,
      status: 'completed',
      startedAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    } as unknown as AcpToolCallViewData
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(createElement(AcpToolCallNode, props(viewData({ status: 'pending' })))))
      const pending = container.querySelector('.dap-rec-status')!
      expect(pending.textContent).toBe(zh['status.pending'])
      expect(pending.getAttribute('role')).toBe('status')

      await act(async () => root.render(createElement(AcpToolCallNode, props(oldData))))
      const toggle = container.querySelector<HTMLButtonElement>('.dap-rec-head')!
      await act(async () => toggle.click())
      expect(container.textContent).toContain(zh['tool.noDetail'])
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
