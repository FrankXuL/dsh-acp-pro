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

let counter = 0

acp.agent({ name: 'mock-catalog-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    agentInfo: { name: 'mock-catalog-agent', version: '1.0.0' },
    authMethods: [],
  }))
  .onRequest('session/new', () => {
    const sessionId = `s${++counter}`
    process.stderr.write(`new-session ${sessionId}\n`)
    return {
      sessionId,
      configOptions: [
        { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'default', options: MODELS },
        { id: 'effort', name: 'Thinking', category: 'thought_level', type: 'select', currentValue: 'low', options: EFFORTS },
      ],
    }
  })
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
