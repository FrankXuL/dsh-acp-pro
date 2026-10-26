import { Readable, Writable } from 'node:stream'
import process from 'node:process'
import * as acp from '@agentclientprotocol/sdk'

const MODELS = [
  { value: 'mock-fast', name: 'Mock Fast' },
  { value: 'mock-smart', name: 'Mock Smart' },
]

const sessions = new Map()
const requireAuth = process.env.MOCK_REQUIRE_AUTH === '1'
let authenticated = false
let counter = 0

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const EFFORTS = [
  { value: 'low', name: 'Low' },
  { value: 'medium', name: 'Medium' },
  { value: 'high', name: 'High', description: 'Think longer' },
]

/** The smart model offers one more level, so an effort can be valid for one model only. */
function effortsOf(model) {
  return model === 'mock-smart' ? [...EFFORTS, { value: 'max', name: 'Max' }] : EFFORTS
}

function configOptions(session) {
  return [
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: session.model, options: MODELS },
    { id: 'effort', name: 'Thinking', category: 'thought_level', type: 'select', currentValue: session.effort, options: effortsOf(session.model) },
  ]
}

async function prompt(params, client) {
  const session = sessions.get(params.sessionId)
  if (session === undefined)
    throw new Error(`unknown session ${params.sessionId}`)
  session.turn += 1
  session.cancelled = false
  const text = params.prompt.filter(block => block.type === 'text').map(block => block.text).join('|')
  const images = params.prompt.filter(block => block.type === 'image')
  const update = update => client.notify(acp.methods.client.session.update, { sessionId: params.sessionId, update })
  session.usage.inputTokens += text.length
  session.usage.outputTokens += 10
  session.usage.totalTokens = session.usage.inputTokens + session.usage.outputTokens

  if (text.includes('slow')) {
    while (!session.cancelled) {
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '.' } })
      await sleep(30)
    }
    return { stopReason: 'cancelled' }
  }

  if (text.includes('edit')) {
    await update({ sessionUpdate: 'tool_call', toolCallId: 'edit-1', title: 'Edit config.json', kind: 'edit', status: 'pending' })
    const answer = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      toolCall: { toolCallId: 'edit-1', title: 'Edit config.json', kind: 'edit' },
      options: [
        { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
        { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      ],
    })
    const picked = answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled'
    await update({ sessionUpdate: 'tool_call_update', toolCallId: 'edit-1', status: picked === 'yes' ? 'completed' : 'failed' })
    await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `permission:${picked}` } })
    return { stopReason: 'end_turn', usage: { ...session.usage } }
  }

  if (text.includes('silent'))
    return { stopReason: 'end_turn' }

  if (text.includes('probe')) {
    await update({ sessionUpdate: 'usage_update', used: 42, size: 123456 })
    const seen = images.map(image => `${image.mimeType}:${image.data}`).join(',')
    await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `effort:${session.effort}|images:${seen}|${text}` } })
    return { stopReason: 'end_turn', usage: { ...session.usage } }
  }

  await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } })
  await update({ sessionUpdate: 'tool_call', toolCallId: `read-${session.turn}`, title: 'Read README.md', kind: 'read', status: 'in_progress' })
  await update({ sessionUpdate: 'tool_call_update', toolCallId: `read-${session.turn}`, status: 'completed' })
  await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `echo[${session.model}|turn ${session.turn}|cwd ${session.cwd}]: ` } })
  await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
  return { stopReason: 'end_turn', usage: { ...session.usage } }
}

acp.agent({ name: 'mock-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false, promptCapabilities: { image: process.env.MOCK_NO_IMAGES !== '1' } },
    agentInfo: { name: 'mock-agent', version: '1.0.0' },
    authMethods: requireAuth ? [{ id: 'token', name: 'Token' }] : [],
  }))
  .onRequest('authenticate', ({ params }) => {
    if (params.methodId !== 'token')
      throw new acp.RequestError(-32602, `unknown auth method ${params.methodId}`)
    authenticated = true
    return {}
  })
  .onRequest('session/new', ({ params }) => {
    if (requireAuth && !authenticated)
      throw acp.RequestError.authRequired()
    const sessionId = `s${++counter}`
    sessions.set(sessionId, {
      model: 'mock-fast',
      effort: 'medium',
      cwd: params.cwd,
      turn: 0,
      cancelled: false,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })
    process.stderr.write(`new-session ${sessionId}\n`)
    return { sessionId, configOptions: configOptions(sessions.get(sessionId)) }
  })
  .onRequest('session/set_config_option', ({ params }) => {
    const session = sessions.get(params.sessionId)
    if (params.configId === 'effort') {
      if (!effortsOf(session.model).some(level => level.value === params.value))
        throw new Error(`unknown effort ${params.value}`)
      session.effort = params.value
      return { configOptions: configOptions(session) }
    }
    if (!MODELS.some(model => model.value === params.value))
      throw new Error(`unknown model ${params.value}`)
    session.model = params.value
    if (!effortsOf(session.model).some(level => level.value === session.effort))
      session.effort = 'medium'
    return { configOptions: configOptions(session) }
  })
  .onRequest('session/prompt', ({ params, client }) => prompt(params, client))
  .onNotification('session/cancel', ({ params }) => {
    const session = sessions.get(params.sessionId)
    if (session !== undefined)
      session.cancelled = true
  })
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
