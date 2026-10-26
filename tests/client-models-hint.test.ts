// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { registerModelsHint } from '../src/client/register/models-hint.ts'
import { rewriteModelsHints } from '../src/client/register/models-hint.utils.ts'

const HINT = '其余字段在 cordis.patch.yml 中，请直接编辑对应段。'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Models page hint for ACP routes', () => {
  it('rewrites only the hint lines of this namespace', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <p id="ours">${HINT} (dsh-acp-pro)</p>
        <p id="other">${HINT} (llm-pi-ai)</p>
        <p id="nested"><span>x</span> (dsh-acp-pro)</p>
      </div>`
    expect(rewriteModelsHints(document.body, 'dsh-acp-pro', 'ACP')).toBe(1)
    expect(document.getElementById('ours')!.textContent).toBe('ACP')
    expect(document.getElementById('other')!.textContent).toBe(`${HINT} (llm-pi-ai)`)
    expect(document.getElementById('nested')!.textContent).toBe('x (dsh-acp-pro)')
  })

  it('patches editors opened later and stops after disposal', async () => {
    const dispose = registerModelsHint('dsh-acp-pro', key => key === 'managedHere' ? '请到 ACP Agents 页编辑' : key)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    dialog.innerHTML = `<p>${HINT} (dsh-acp-pro)</p>`
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(dialog.querySelector('p')!.textContent).toBe('请到 ACP Agents 页编辑')

    dispose()
    dialog.innerHTML = `<p>${HINT} (dsh-acp-pro)</p>`
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(dialog.querySelector('p')!.textContent).toBe(`${HINT} (dsh-acp-pro)`)
  })
})
