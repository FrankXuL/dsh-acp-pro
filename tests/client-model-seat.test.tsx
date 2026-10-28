// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it } from 'vitest'
import { ModelSeat } from '../src/client/components/model-seat.tsx'

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

/** Methods read `this`, mirroring ConfigFormController and SnapshotStore consumers. */
class FakeForm {
  private readonly snapshot: {
    status: 'ready'
    value: unknown
    base: undefined
    user: undefined
    revision: number
    writable: boolean
    mode: 'host'
  }

  constructor(value: unknown = { agents: { cc: { displayName: 'Claude Code' } } }) {
    this.snapshot = { status: 'ready', value, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host' }
  }

  getSnapshot() {
    return this.snapshot
  }

  subscribe() {
    return () => {}
  }

  async mutate() {
    return true
  }
}

class FakeDirectory {
  private readonly snapshot = {
    current: null,
    routable: null,
    groups: [{ id: 'cc', name: 'Claude Code', models: [{ id: 'default', name: 'Claude Code (default)' }] }],
    failures: [],
    status: 'ready' as const,
    pending: null,
    error: null,
  }

  readonly store = {
    getSnapshot: () => this.snapshot,
    subscribe: () => () => {},
  }

  async load() {
    return this.snapshot
  }

  async select() {
    return { ok: true as const, value: undefined }
  }
}

describe('model seat', () => {
  it('renders with this-bound form/store without throwing', async () => {
    const directory = new FakeDirectory()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(ModelSeat as never, {
        sessionId: 'session-a',
        locked: false,
        available: true,
        models: directory,
        config: new FakeForm(),
      } as never)))
      expect(container.textContent).toContain('选择模型')
    }
    finally {
      await act(async () => root.unmount())
    }
  })
})

describe('model seat favorites wiring', () => {
  it('hides a disabled route from the rail and shows configured favorites', async () => {
    const directory = new FakeDirectory()
    const config = new FakeForm({
      agents: {
        cc: { displayName: 'Claude Code', command: '/bin/cc', enabled: true },
        off: { displayName: 'Disabled', command: '/bin/off', enabled: false },
      },
      favorites: [{ provider: 'cc', model: 'default' }],
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(ModelSeat as never, {
        sessionId: 'session-a',
        locked: false,
        available: true,
        models: directory,
        config: config,
      } as never)))
      // Open the root pane, then the model pane with its rail.
      await act(async () => container.querySelector<HTMLButtonElement>('.dsh-model-seat-trigger')!.click())
      await act(async () => container.querySelectorAll<HTMLButtonElement>('.dsh-model-seat-cell')[0]!.click())
      const labels = [...container.querySelectorAll('.dsh-model-seat-rail-btn')].map(button => button.getAttribute('aria-label'))
      expect(labels).toContain('Claude Code')
      expect(labels).not.toContain('Disabled')
    }
    finally {
      await act(async () => root.unmount())
    }
  })
})

describe('model seat effort submission', () => {
  it('submits the picked reasoning level with the current provider/model', async () => {
    const calls: unknown[] = []
    const snapshot = {
      current: { provider: 'cc', model: 'default', reasoningEffort: 'low' },
      routable: true,
      groups: [{
        id: 'cc',
        name: 'Claude Code',
        models: [{
          id: 'default',
          name: 'Claude Code (default)',
          reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' },
        }],
      }],
      failures: [],
      status: 'ready' as const,
      pending: null,
      error: null,
    }
    const directory = {
      store: { getSnapshot: () => snapshot, subscribe: () => () => {} },
      load: async () => snapshot,
      select: async (selection: unknown) => {
        calls.push(selection)
        return { ok: true as const, value: undefined }
      },
    }
    const config = new FakeForm({
      agents: { cc: { displayName: 'Claude Code', command: '/bin/cc' } },
      favorites: [],
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(ModelSeat as never, {
        sessionId: 'session-a', locked: false, available: true, models: directory, config,
      } as never)))
      await act(async () => container.querySelector<HTMLButtonElement>('.dsh-model-seat-trigger')!.click())
      const cells = [...container.querySelectorAll<HTMLButtonElement>('.dsh-model-seat-cell')]
      // Second root cell is 推理.
      await act(async () => cells[1]!.click())
      const rows = [...container.querySelectorAll<HTMLButtonElement>('.dsh-model-seat-model')]
      expect(rows.map(row => row.textContent)).toEqual(['Low✓', 'High'])
      await act(async () => rows[1]!.click())
      expect(calls).toEqual([{ provider: 'cc', model: 'default', reasoningEffort: 'high' }])
    }
    finally {
      await act(async () => root.unmount())
    }
  })
})

describe('source marks', () => {
  it('draws the native fish mark for the platform tab and a mark on the trigger', async () => {
    const snapshot = {
      current: null,
      routable: null,
      groups: [{ id: 'cc', name: 'Claude Code', models: [{ id: 'default', name: 'Claude Code (default)' }] }],
      failures: [],
      status: 'ready' as const,
      pending: null,
      error: null,
    }
    const directory = { store: { getSnapshot: () => snapshot, subscribe: () => () => {} }, load: async () => snapshot, select: async () => ({ ok: true as const, value: undefined }) }
    const config = new FakeForm({ agents: { cc: { displayName: 'Claude Code', command: '/bin/cc' } }, favorites: [] })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(ModelSeat as never, {
        sessionId: 'session-a', locked: false, available: true, models: directory, config,
      } as never)))
      // The trigger always carries the current source's mark.
      expect(container.querySelector('.dsh-model-seat-trigger-icon svg')).not.toBeNull()
      await act(async () => container.querySelector<HTMLButtonElement>('.dsh-model-seat-trigger')!.click())
      await act(async () => container.querySelectorAll<HTMLButtonElement>('.dsh-model-seat-cell')[0]!.click())
      const tabs = [...container.querySelectorAll('.dsh-model-seat-rail-btn')]
      const platform = tabs.find(tab => tab.getAttribute('aria-label') === 'DSH')!
      // Platform uses the native fish svg, not a letter.
      expect(platform.querySelector('svg')).not.toBeNull()
      const claudeTab = tabs.find(tab => tab.getAttribute('aria-label') === 'Claude Code')!
      expect(claudeTab.querySelector('img')).not.toBeNull()
    }
    finally {
      await act(async () => root.unmount())
    }
  })
})
