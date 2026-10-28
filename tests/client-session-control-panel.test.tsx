// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AcpSessionSnapshot } from '../src/shared/session-control.ts'
import type { AcpRemoteResult, AcpSessionControlClient } from '../src/shared/session-control-remote.ts'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SessionControlPanel } from '../src/client/components/session-control-panel.tsx'
import { zh, type Translate } from '../src/client/locales/index.ts'

const dictionary: Record<string, string> = zh
const t = ((key: string) => dictionary[key] ?? key) as unknown as Translate

function ok<T>(value: T): AcpRemoteResult<T> {
  return { ok: true, value }
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

function snapshot(overrides: Partial<AcpSessionSnapshot> = {}): AcpSessionSnapshot {
  return {
    provider: 'codex',
    sessionId: 'session-a',
    turnState: 'idle',
    revision: 1,
    configOptions: [
      {
        type: 'select',
        id: 'reasoning_effort',
        name: 'Reasoning effort',
        category: 'mode',
        currentValue: 'balanced',
        options: [
          { value: 'balanced', name: 'Balanced' },
          { value: 'low', name: 'Low' },
        ],
      },
      {
        type: 'select',
        id: 'selected_model',
        name: 'Model',
        category: 'model',
        currentValue: 'model-x',
        options: [{ value: 'model-x', name: 'Model X' }],
      },
      {
        type: 'select',
        id: 'thought_level',
        name: 'Thought level',
        category: 'thought_level',
        currentValue: 'high',
        options: [{ value: 'high', name: 'High' }],
      },
    ],
    availableModes: [{ id: 'legacy-mode', name: 'Legacy mode' }],
    availableCommands: [{ name: 'review', description: 'Review changes' }],
    recovery: 'loaded',
    ...overrides,
  }
}

function control(getSessionSnapshots: AcpSessionControlClient['getSessionSnapshots']): AcpSessionControlClient {
  return {
    getSessionSnapshots: vi.fn(getSessionSnapshots),
    setSessionConfig: vi.fn(async () => ({ ok: true, value: snapshot() })),
    setSessionMode: vi.fn(async () => ({ ok: true, value: snapshot() })),
    resetSession: vi.fn(async () => ({ ok: true, value: undefined })),
  } as unknown as AcpSessionControlClient
}

function panelProps(sessionId: string, remote: AcpSessionControlClient): Parameters<typeof SessionControlPanel>[0] {
  return {
    sessionId,
    input: { draft: '', phase: 'plain' } as InputState,
    inputActions: {
      captureInsertion: vi.fn(() => ({ start: 0, end: 0, draftRev: 0 })),
      insertText: vi.fn(() => true),
    } as unknown as InputActions,
    control: remote,
    t,
  }
}

describe('ACP session control panel polling', () => {
  it('shows a newly bound session after the first turn creates it', async () => {
    vi.useFakeTimers()
    const getSessionSnapshots = vi.fn<AcpSessionControlClient['getSessionSnapshots']>()
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValue(ok([snapshot()]))
    const remote = control(getSessionSnapshots)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(createElement(SessionControlPanel, panelProps('session-a', remote))))
      expect(remote.getSessionSnapshots).toHaveBeenCalledTimes(1)
      expect(container.querySelector('.dsh-acp-session-control')).toBeNull()

      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      expect(remote.getSessionSnapshots).toHaveBeenCalledTimes(2)
      expect(container.textContent).toContain('ACP 会话控制')
      expect(container.querySelectorAll('select')).toHaveLength(1)
      expect(container.querySelector('[aria-label="Reasoning effort"]')).not.toBeNull()
      expect(container.querySelector('.dsh-acp-session-control__native')?.textContent).toContain('model-x')
    }
    finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('refreshes external configuration and turn state without duplicating mode controls', async () => {
    vi.useFakeTimers()
    const initial = snapshot()
    const changed = snapshot({
      revision: 2,
      turnState: 'running',
      configOptions: initial.configOptions.map(option => option.id === 'reasoning_effort'
        ? { ...option, currentValue: 'low' }
        : option),
    })
    const getSessionSnapshots = vi.fn<AcpSessionControlClient['getSessionSnapshots']>()
      .mockResolvedValueOnce(ok([initial]))
      .mockResolvedValue(ok([changed]))
    const remote = control(getSessionSnapshots)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(createElement(SessionControlPanel, panelProps('session-a', remote))))
      expect(container.querySelector<HTMLSelectElement>('[aria-label="Reasoning effort"]')?.value).toBe('balanced')
      expect(container.textContent).not.toContain('下一轮生效')

      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      expect(container.querySelector<HTMLSelectElement>('[aria-label="Reasoning effort"]')?.value).toBe('low')
      expect(container.textContent).toContain('下一轮生效')
      expect(container.querySelectorAll('select')).toHaveLength(1)
    }
    finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('ignores a late response for the previous DSH session', async () => {
    vi.useFakeTimers()
    let resolveOld!: (value: AcpRemoteResult<AcpSessionSnapshot[]>) => void
    const oldResult = new Promise<AcpRemoteResult<AcpSessionSnapshot[]>>((resolve) => { resolveOld = resolve })
    const nextSession = snapshot({
      sessionId: 'session-b',
      revision: 3,
      configOptions: snapshot().configOptions.map(option => option.id === 'reasoning_effort'
        ? { ...option, currentValue: 'low' }
        : option),
    })
    const getSessionSnapshots = vi.fn<AcpSessionControlClient['getSessionSnapshots']>(({ dshSessionId }) => dshSessionId === 'session-a'
      ? oldResult
      : Promise.resolve(ok([nextSession])))
    const remote = control(getSessionSnapshots)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    try {
      await act(async () => root.render(createElement(SessionControlPanel, panelProps('session-a', remote))))
      await act(async () => root.render(createElement(SessionControlPanel, panelProps('session-b', remote))))
      await act(async () => { resolveOld(ok([snapshot()])); await oldResult })
      expect(container.querySelector('.dsh-acp-session-control')).toBeNull()

      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
      expect(container.textContent).toContain('ACP 会话控制')
      expect(container.querySelector<HTMLSelectElement>('[aria-label="Reasoning effort"]')?.value).toBe('low')
      expect(remote.getSessionSnapshots).toHaveBeenLastCalledWith({ dshSessionId: 'session-b' })
    }
    finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
