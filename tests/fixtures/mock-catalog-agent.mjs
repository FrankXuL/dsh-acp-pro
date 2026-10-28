/**
 * An ACP agent that deliberately advertises a dirty catalog. claude-code-acp really does
 * advertise its own `default` model, which collides with the synthetic default the adapter
 * prepends; other agents send duplicate ids, blank ids, empty names or non-string
 * descriptions. The adapter must clean all of it before dsh's registry validates the
 * catalog, so this fixture offers one of each.
 */
import { Readable, Writable } from 'node:stream'
import process from 'node:process'
import * as acp from '@agentclientprotocol/sdk'
import { appendFileSync } from 'node:fs'

const MODELS = [
  { value: 'default', name: 'Agent Default' },
  { value: 'mock-fast', name: 'Fast' },
  { value: 'mock-fast', name: 'Fast (duplicate)' },
  { value: '', name: 'Blank id' },
  { value: '   ', name: 'Blank id too' },
  { value: 'mock-nameless', name: '' },
  { value: 'mock-weird', name: 'Weird', description: 42 },
]

const EFFORTS = [
  { value: 'low', name: 'Low' },
  { value: 'low', name: 'Low (duplicate)' },
  { value: '', name: 'Blank id' },
  { value: 'high', name: '' },
]

const sessions = new Map()
let counter = 0

function configOptions(session) {
  return [
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: session.model, options: MODELS },
    { id: 'effort', name: 'Thinking', category: 'thought_level', type: 'select', currentValue: session.effort, options: EFFORTS },
  ]
}

acp.agent({ name: 'mock-catalog-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    agentInfo: { name: 'mock-catalog-agent', version: '1.0.0' },
    authMethods: [],
  }))
  .onRequest('session/new', () => {
    const sessionId = `s${++counter}`
    try { appendFileSync(process.env.PROBE_LOG ?? '/tmp/catalog-reuse.log', `NEW ${sessionId}\n`) } catch {}
    const session = { model: 'default', effort: 'low' }
    sessions.set(sessionId, session)
    process.stderr.write(`new-session ${sessionId}\n`)
    return { sessionId, configOptions: configOptions(session) }
  })
  .onRequest('session/close', ({ params }) => {
    try { appendFileSync(process.env.PROBE_LOG ?? '/tmp/catalog-reuse.log', `CLOSE ${params.sessionId}\n`) } catch {}
    return {}
  })
  .onRequest('session/set_config_option', ({ params }) => {
    const session = sessions.get(params.sessionId)
    if (session === undefined)
      throw new Error(`unknown session ${params.sessionId}`)
    if (params.configId === 'model' && MODELS.some(model => model.value === params.value))
      session.model = params.value
    else if (params.configId === 'effort' && EFFORTS.some(effort => effort.value === params.value))
      session.effort = params.value
    else
      throw new Error(`unknown config option ${params.configId}=${params.value}`)
    return { configOptions: configOptions(session) }
  })
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
