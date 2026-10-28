// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it } from 'vitest'
import { ModelSeatProto } from '../src/client/components/model-seat-proto.tsx'

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

/** Methods read `this`, mirroring ConfigFormController and SnapshotStore consumers. */
class FakeForm {
  private readonly snapshot = {
    status: 'ready' as const,
    value: { agents: { cc: { displayName: 'Claude Code' } } },
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host' as const,
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

class FakeStore {
  private readonly snapshot = {
    current: null,
    routable: null,
    groups: [{ id: 'cc', name: 'Claude Code', models: [{ id: 'default', name: 'Claude Code (default)' }] }],
    failures: [],
    status: 'ready' as const,
    pending: null,
    error: null,
  }

  getSnapshot() {
    return this.snapshot
  }

  subscribe() {
    return () => {}
  }

  async load() {
    return this.snapshot
  }

  async select() {
    return { ok: true as const, value: undefined }
  }
}

describe('ModelSeatProto prototype', () => {
  it('renders with this-bound form/store without throwing', async () => {
    const store = new FakeStore()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(ModelSeatProto as never, {
        sessionId: 'session-a',
        locked: false,
        available: true,
        models: store,
        config: new FakeForm(),
      } as never)))
      expect(container.textContent).toContain('选择模型')
    }
    finally {
      await act(async () => root.unmount())
    }
  })
})
