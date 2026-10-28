import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { agentsOf, Config } from '../src/host/config/schema.ts'
import { AcpAdapter } from '../src/host/service/acp-adapter.ts'
import { inspectAgent, parseSmokeArgs } from './smoke-lib.mts'

const usage = 'usage: node --import tsx scripts/smoke.mts <agent-command> [args...] [-- prompt]'

async function streamPrompt(command: string, args: string[], prompt: string): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-acp-smoke-prompt-'))
  let adapter: AcpAdapter | undefined
  try {
    const profile = agentsOf(Config({ agents: { smoke: { command, args, cwd, permission: 'reject', authMethod: process.env.ACP_AUTH_METHOD } } } as never)).smoke!
    adapter = new AcpAdapter({
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      agentOf: () => undefined,
      approve: undefined,
      readImage: undefined,
    }, () => new Map([['smoke', profile]]))
    const model = process.env.ACP_MODEL ?? 'default'
    for await (const chunk of adapter.stream({ provider: 'smoke', model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] })) {
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta')
        process.stdout.write(chunk.text)
      else if (chunk.type === 'usage' || chunk.type === 'finish')
        console.log(`\n${chunk.type}:`, JSON.stringify(chunk.type === 'usage' ? chunk.usage : chunk.reason))
    }
  }
  finally {
    adapter?.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const parsed = parseSmokeArgs(process.argv.slice(2))
  if (parsed === undefined) {
    console.error(usage)
    process.exitCode = 1
    return
  }

  try {
    const report = await inspectAgent({
      command: parsed.command,
      args: parsed.args,
      authMethod: process.env.ACP_AUTH_METHOD,
    })
    console.log(JSON.stringify(report, null, 2))
  }
  catch {
    console.error('ACP smoke diagnostic failed')
    process.exitCode = 1
    return
  }

  if (parsed.prompt !== undefined) {
    try {
      await streamPrompt(parsed.command, parsed.args, parsed.prompt)
    }
    catch {
      console.error('\nACP smoke prompt failed')
      process.exitCode = 1
    }
  }
}

await main()
