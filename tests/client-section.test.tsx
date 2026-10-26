import type { Translate } from '../src/client/locales/index.ts'
import type { ConfigForm, ConfigFormSnapshot, SettingsPathOpView } from '../src/client/types/runtime.ts'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentImportView } from '../src/client/components/agent-import-view.tsx'
import { AgentsSection } from '../src/client/components/agents-section.tsx'
import { zh } from '../src/client/locales/index.ts'

/** Mirrors the real ConfigFormController: methods depend on `this`, as an unbound call would expose. */
class FakeForm implements ConfigForm {
  private readonly store: { snapshot: ConfigFormSnapshot, listeners: Set<() => void> }

  constructor(snapshot: ConfigFormSnapshot) {
    this.store = { snapshot, listeners: new Set() }
  }

  getSnapshot(): ConfigFormSnapshot {
    return this.store.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.store.listeners.add(listener)
    return () => this.store.listeners.delete(listener)
  }

  async mutate(_ops: readonly SettingsPathOpView[]): Promise<boolean> {
    return true
  }
}

const t: Translate = (key, params) => zh[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))

const llm = { discoverModels: async () => ({ ok: true as const, value: [] }) }

describe('agents settings section', () => {
  it('renders the configured agents from a this-bound form', () => {
    const form = new FakeForm({
      status: 'ready',
      value: { agents: { codex: { displayName: 'Codex (ACP)', command: '/bin/node', args: ['codex-acp.js'], env: {}, models: [], permission: 'ask' } } },
      base: { agents: {} },
      user: { agents: { codex: { command: '/bin/node' } } },
      revision: 1,
      writable: true,
      mode: 'host',
    })
    const html = renderToStaticMarkup(<AgentsSection form={form} llm={llm} t={t} />)
    expect(html).toContain('Codex (ACP)')
    expect(html).toContain('/bin/node codex-acp.js')
    expect(html).toContain('自动发现模型')
    expect(html).toContain(zh.import)
  })

  it('renders the loading and unavailable states', () => {
    const snapshot = (status: ConfigFormSnapshot['status']): ConfigFormSnapshot => ({ status, value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host' })
    expect(renderToStaticMarkup(<AgentsSection form={new FakeForm(snapshot('loading'))} llm={llm} t={t} />)).toContain(zh.loading)
    expect(renderToStaticMarkup(<AgentsSection form={new FakeForm(snapshot('unavailable'))} llm={llm} t={t} />)).toContain('无法读取')
  })

  it('renders the import view with its paste field', () => {
    const html = renderToStaticMarkup(<AgentImportView t={t} rows={[]} writable busy={false} message={null} onCancel={() => {}} onImport={() => {}} />)
    expect(html).toContain(zh.importTitle)
    expect(html).toContain('agent_servers')
    expect(html).toContain('导入 0 个 Agent')
  })
})
