import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { agentsOf, Config } from '../src/host/config/schema.ts'
import { AcpAdapter } from '../src/host/service/acp-adapter.ts'

const separator = process.argv.indexOf('--')
const [command, ...args] = separator === -1 ? process.argv.slice(2) : process.argv.slice(2, separator)
const prompt = separator === -1 ? undefined : process.argv.slice(separator + 1).join(' ')
if (command === undefined) {
  console.error('usage: npx tsx scripts/smoke.mts <agent-command> [args...] [-- prompt]')
  process.exit(1)
}

const cwd = mkdtempSync(join(tmpdir(), 'dsh-acp-smoke-'))
const profile = agentsOf(Config({ agents: { smoke: { command, args, cwd, permission: 'reject', authMethod: process.env.ACP_AUTH_METHOD } } } as never)).smoke!
const adapter = new AcpAdapter({ logger: console, agentOf: () => undefined, approve: undefined, readImage: undefined }, () => new Map([['smoke', profile]]))
try {
  const models = await adapter.listModels('smoke')
  console.log('models:', models.map(model => `${model.id} (${model.name})`).join(', '))
  if (prompt !== undefined) {
    const model = process.env.ACP_MODEL ?? 'default'
    for await (const chunk of adapter.stream({ provider: 'smoke', model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] })) {
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta')
        process.stdout.write(chunk.text)
      else if (chunk.type === 'usage' || chunk.type === 'finish')
        console.log(`\n${chunk.type}:`, JSON.stringify(chunk.type === 'usage' ? chunk.usage : chunk.reason))
    }
  }
}
finally {
  adapter.dispose()
}
