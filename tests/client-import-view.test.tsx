// @vitest-environment happy-dom
import type { Translate } from '../src/client/locales/index.ts'
import type { AgentImportEntry } from '../src/client/service/agents.types.ts'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentImportView } from '../src/client/components/agent-import-view.tsx'
import { zh } from '../src/client/locales/index.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const t: Translate = (key, params) => zh[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))

const JSON_TEXT = JSON.stringify({
  agent_servers: {
    'CodeBuddy Code': { command: 'codebuddy', args: ['--acp'] },
    'Trae': { command: 'traecli', args: ['--acp'] },
    'Claude': { command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp'] },
  },
})

let container: HTMLDivElement | undefined

afterEach(() => {
  container?.remove()
  container = undefined
})

function setTextarea(element: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(label: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll('button')].find(element => element.textContent === label)
  if (found === undefined)
    throw new Error(`no button "${label}"`)
  return found
}

describe('agent import selection', () => {
  it('imports only the agents left checked', async () => {
    const imported: (readonly AgentImportEntry[])[] = []
    container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<AgentImportView t={t} rows={[]} writable busy={false} message={null} onCancel={() => {}} onImport={entries => imported.push(entries)} />)
    })
    await act(async () => setTextarea(container!.querySelector('textarea')!, JSON_TEXT))
    await act(async () => button(zh.importParse).click())
    expect(button('导入 3 个 Agent').disabled).toBe(false)

    await act(async () => (container!.querySelector('[aria-label="导入 Trae"]') as HTMLInputElement).click())
    await act(async () => button('导入 2 个 Agent').click())
    expect(imported.map(entries => entries.map(entry => entry.route))).toEqual([['codebuddy-code', 'claude']])

    await act(async () => button(zh.importSelectAll).click())
    expect(button('导入 3 个 Agent')).toBeDefined()
    await act(async () => button(zh.importSelectNone).click())
    expect(button('导入 0 个 Agent').disabled).toBe(true)
    await act(async () => root.unmount())
  })
})
