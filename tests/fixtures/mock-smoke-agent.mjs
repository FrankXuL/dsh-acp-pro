import { writeFileSync } from 'node:fs'
import process from 'node:process'
import * as acp from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'

const closeMarker = process.env.DSH_SMOKE_CLOSE_MARKER
const promptMarker = process.env.DSH_SMOKE_PROMPT_MARKER
let announceCommands

acp.agent({ name: 'mock-smoke-agent' })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentInfo: { name: 'Mock smoke agent', version: '1.0.0' },
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true, audio: false },
      sessionCapabilities: { close: {} },
      _meta: { private: 'must not be reported' },
    },
  }))
  .onRequest(acp.methods.agent.session.new, async ({ client }) => {
    const sessionId = 'smoke-session'
    announceCommands = () => client.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'inspect', description: 'Command details are omitted', input: { hint: 'private command input' } }],
      },
    })
    if (process.env.DSH_SMOKE_LATE_COMMANDS !== '1')
      await announceCommands()
    return {
      sessionId,
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'mock-fast',
          options: [{ value: 'mock-fast', name: 'Mock Fast' }],
        },
        {
          id: 'api_token',
          name: 'API token',
          category: '_auth',
          type: 'select',
          currentValue: 'private-token-value',
          options: [{ value: 'private-token-value', name: 'Private token' }],
        },
      ],
      modes: {
        currentModeId: 'ask',
        availableModes: [{ id: 'ask', name: 'Ask', description: 'Mode details are omitted' }],
      },
    }
  })
  .onRequest(acp.methods.agent.session.close, async ({ params }) => {
    if (process.env.DSH_SMOKE_LATE_COMMANDS === '1')
      await announceCommands()
    if (closeMarker !== undefined)
      writeFileSync(closeMarker, params.sessionId)
    return {}
  })
  .onRequest(acp.methods.agent.session.prompt, () => {
    if (promptMarker !== undefined)
      writeFileSync(promptMarker, 'unexpected prompt')
    return { stopReason: 'end_turn' }
  })
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))

setInterval(() => {}, 60_000)
