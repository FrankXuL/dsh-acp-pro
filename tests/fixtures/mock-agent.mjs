import { Readable, Writable } from 'node:stream'
import process from 'node:process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import * as acp from '@agentclientprotocol/sdk'

const MODELS = [
  { value: 'mock-fast', name: 'Mock Fast' },
  { value: 'mock-smart', name: 'Mock Smart' },
]

const sessions = new Map()
const requireAuth = process.env.MOCK_REQUIRE_AUTH === '1'
const supportsClose = process.env.MOCK_SUPPORT_CLOSE === '1'
const requirePreviousSessionClosed = process.env.MOCK_REQUIRE_PREVIOUS_SESSION_CLOSED === '1'
const sessionNewDelayMs = Number(process.env.MOCK_SESSION_NEW_DELAY_MS ?? 0)
const supportsLoad = process.env.MOCK_SUPPORT_LOAD === '1'
const supportsModes = process.env.MOCK_SUPPORT_MODES === '1'
const stateFile = process.env.MOCK_SESSION_STATE_FILE
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

function defaultEffortOf(model) {
  return model === 'mock-smart' ? 'high' : 'medium'
}

function configOptions(session) {
  const options = [
    { id: 'model', name: 'Model', ...process.env.MOCK_NATIVE_IDS_NO_CATEGORY === '1' ? {} : { category: 'model' }, type: 'select', currentValue: session.model, options: MODELS },
    { id: process.env.MOCK_NATIVE_IDS_NO_CATEGORY === '1' ? 'thought_level' : 'effort', name: 'Thinking', ...process.env.MOCK_NATIVE_IDS_NO_CATEGORY === '1' ? {} : { category: 'thought_level' }, type: 'select', currentValue: session.effort, options: effortsOf(session.model) },
  ]
  if (process.env.MOCK_UNCATEGORIZED_CONFIG === '1') {
    options.push({
      id: 'custom', name: 'Custom', type: 'select', currentValue: session.custom ?? 'one',
      options: [{ value: 'one', name: 'One' }, { value: 'two', name: 'Two' }],
    })
  }
  if (process.env.MOCK_EXTRA_CONFIG === '1') {
    options.push({
      id: 'style', name: 'Response style', category: 'model_config', type: 'select', currentValue: session.style,
      options: [{ group: 'tone', name: 'Tone', options: [
        { value: 'balanced', name: 'Balanced' },
        { value: 'concise', name: 'Concise', description: 'Short answers' },
      ] }],
    })
  }
  if (process.env.MOCK_MODE_CONFIG === '1') {
    options.push({
      id: 'mode-config', name: 'Mode', category: 'mode', type: 'select', currentValue: session.mode,
      options: [{ value: 'standard', name: 'Standard' }, { value: 'plan', name: 'Plan' }],
    })
  }
  return options
}

function modeState(session) {
  return supportsModes ? {
    currentModeId: session.mode,
    availableModes: [
      { id: 'standard', name: 'Standard' },
      { id: 'plan', name: 'Plan', description: 'Plan before acting' },
    ],
  } : undefined
}

function readState() {
  if (stateFile === undefined)
    return {}
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'))
  }
  catch {
    return {}
  }
}

function persistSession(sessionId, session) {
  if (stateFile === undefined)
    return
  const saved = readState()
  saved[sessionId] = session
  writeFileSync(stateFile, JSON.stringify(saved))
}

function deleteSavedSession(sessionId) {
  if (stateFile === undefined)
    return
  const saved = readState()
  delete saved[sessionId]
  writeFileSync(stateFile, JSON.stringify(saved))
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

  if (process.env.MOCK_AVAILABLE_COMMANDS === '1') {
    await update({ sessionUpdate: 'available_commands_update', availableCommands: [
      { name: 'review', description: 'Review this change', input: { hint: 'optional focus' } },
    ] })
  }
  if (text.includes('delay') && Number(process.env.MOCK_PROMPT_DELAY_MS ?? 0) > 0) {
    const marker = process.env.MOCK_DELAY_MARKER
    if (marker !== undefined)
      writeFileSync(marker, 'started')
    await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'starting' } })
    await sleep(Number(process.env.MOCK_PROMPT_DELAY_MS))
  }

  if (text.includes('hang') && process.env.MOCK_HANG_AFTER_FIRST_UPDATE === '1') {
    await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'started' } })
    await new Promise(() => {})
  }

  if (text.includes('crash-after-side-effect') && process.env.MOCK_CRASH_AFTER_SIDE_EFFECT === '1') {
    const effectFile = process.env.MOCK_SIDE_EFFECT_FILE
    if (effectFile !== undefined)
      appendFileSync(effectFile, 'effect\n')
    persistSession(params.sessionId, session)
    process.exit(81)
  }

  if (text.includes('slow')) {
    while (!session.cancelled) {
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '.' } })
      await sleep(30)
    }
    persistSession(params.sessionId, session)
    return { stopReason: 'cancelled' }
  }

  // Cancelled, yet the answer still settles as a normal end_turn — what a real agent does
  // when it finishes inside the client's cancel grace window. The client must keep
  // reporting the user's abort instead of overwriting it with a late stop.
  if (text.includes('cancel-race')) {
    await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'working' } })
    while (!session.cancelled)
      await sleep(10)
    await sleep(Number(process.env.MOCK_CANCEL_RACE_DELAY_MS ?? 50))
    persistSession(params.sessionId, session)
    return { stopReason: 'end_turn', usage: { ...session.usage } }
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
    persistSession(params.sessionId, session)
    return { stopReason: 'end_turn', usage: { ...session.usage } }
  }

  if (text.includes('silent'))
    return { stopReason: 'end_turn' }

  // A turn that thinks but never writes an answer. The transcript still carries the
  // reasoning, so it is not the empty turn EMPTY_RESPONSE describes.
  if (text.includes('thought-only')) {
    await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'weighed it' } })
    persistSession(params.sessionId, session)
    return { stopReason: 'end_turn', usage: { ...session.usage } }
  }

  if (text.includes('probe')) {
    await update({ sessionUpdate: 'usage_update', used: 42, size: 123456 })
    const seen = images.map(image => `${image.mimeType}:${image.data}`).join(',')
    await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `effort:${session.effort}|images:${seen}|${text}` } })
    persistSession(params.sessionId, session)
    if (process.env.MOCK_PERMISSION_AFTER_RESPONSE === '1') {
      const resultFile = process.env.MOCK_PERMISSION_AFTER_RESPONSE_RESULT
      setTimeout(() => {
        void client.request(acp.methods.client.session.requestPermission, {
          sessionId: params.sessionId,
          toolCall: { toolCallId: 'late-permission', title: 'Late permission', kind: 'edit' },
          options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }],
        }).then((response) => {
          if (resultFile !== undefined)
            writeFileSync(resultFile, JSON.stringify(response.outcome))
        }).catch(() => {})
      }, 10)
    }
    return { stopReason: 'end_turn', usage: { ...session.usage } }
  }

  await update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } })
  await update({ sessionUpdate: 'tool_call', toolCallId: `read-${session.turn}`, title: 'Read README.md', kind: 'read', status: 'in_progress' })
  await update({ sessionUpdate: 'tool_call_update', toolCallId: `read-${session.turn}`, status: 'completed' })
  await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `echo[${session.model}|turn ${session.turn}|cwd ${session.cwd}]: ` } })
  await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
  persistSession(params.sessionId, session)
  return { stopReason: 'end_turn', usage: { ...session.usage } }
}

acp.agent({ name: 'mock-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: supportsLoad,
      promptCapabilities: { image: process.env.MOCK_NO_IMAGES !== '1' },
      ...supportsClose ? { sessionCapabilities: { close: {} } } : {},
    },
    agentInfo: { name: 'mock-agent', version: '1.0.0' },
    authMethods: requireAuth ? [{ id: 'token', name: 'Token' }] : [],
  }))
  .onRequest('authenticate', ({ params }) => {
    if (params.methodId !== 'token')
      throw new acp.RequestError(-32602, `unknown auth method ${params.methodId}`)
    authenticated = true
    return {}
  })
  .onRequest('session/new', async ({ params, client }) => {
    if (requireAuth && !authenticated)
      throw acp.RequestError.authRequired()
    if (requirePreviousSessionClosed && sessions.size > 0)
      throw new Error('previous session is still open')
    if (sessionNewDelayMs > 0)
      await sleep(sessionNewDelayMs)
    const sessionId = process.env.MOCK_FIXED_SESSION_ID ?? `s${++counter}`
    const session = {
      model: 'mock-fast',
      effort: 'medium',
      style: 'balanced',
      mode: 'standard',
      cwd: params.cwd,
      turn: 0,
      cancelled: false,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    }
    sessions.set(sessionId, session)
    persistSession(sessionId, session)
    process.stderr.write(`new-session ${sessionId}\n`)
    const responseConfigOptions = configOptions(session)
    const responseModes = modeState(session)
    if (process.env.MOCK_NEW_UPDATE_BEFORE_RESPONSE === '1') {
      session.style = 'concise'
      session.mode = 'plan'
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: 'config_option_update', configOptions: configOptions(session) },
      })
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: 'current_mode_update', currentModeId: 'plan' },
      })
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: 'available_commands_update', availableCommands: [
          { name: 'before-response', description: 'Sent before session/new returns', input: { hint: 'early' } },
        ] },
      })
    }
    // codex-acp reports a by-name MCP skip as a `tool_call` while `session/new` is still open,
    // which is earlier than the turn its record sink belongs to.
    if (process.env.MOCK_NEW_TOOL_CALL_BEFORE_RESPONSE === '1') {
      await client.notify(acp.methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'mcp_startup.context-mode.early',
          kind: 'other',
          title: 'mcp__context-mode__startup',
          status: 'failed',
          content: [{ type: 'text', text: '[codex-acp] MCP server `context-mode` was not started, because the Codex config already defines an MCP server with this name.' }],
        },
      })
    }
    return { sessionId, configOptions: responseConfigOptions, ...responseModes === undefined ? {} : { modes: responseModes } }
  })
  .onRequest('session/load', async ({ params, client }) => {
    const loadMarker = process.env.MOCK_LOAD_MARKER
    if (loadMarker !== undefined)
      writeFileSync(loadMarker, 'called')
    if (!supportsLoad)
      throw new Error('session/load is not supported')
    const session = readState()[params.sessionId]
    if (session === undefined)
      throw new Error(`unknown session ${params.sessionId}`)
    sessions.set(params.sessionId, session)
    if (process.env.MOCK_LOAD_PERMISSION === '1') {
      const response = await client.request(acp.methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: { toolCallId: 'load-permission', title: 'Load state', kind: 'read' },
        options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }],
      })
      const resultFile = process.env.MOCK_LOAD_PERMISSION_RESULT
      if (resultFile !== undefined)
        writeFileSync(resultFile, JSON.stringify(response.outcome))
    }
    if (process.env.MOCK_LOAD_CONFIG === '1') {
      const trace = process.env.MOCK_LOAD_CONFIG_TRACE
      if (trace !== undefined)
        writeFileSync(trace, JSON.stringify(configOptions(session)))
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'config_option_update', configOptions: configOptions(session) },
      })
    }
    if (process.env.MOCK_AVAILABLE_COMMANDS === '1' || process.env.MOCK_LOAD_COMMANDS === '1') {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'available_commands_update', availableCommands: [
          { name: 'review', description: 'Review this change', input: { hint: 'optional focus' } },
        ] },
      })
    }
    return { configOptions: configOptions(session), ...modeState(session) === undefined ? {} : { modes: modeState(session) } }
  })
  .onRequest('session/close', ({ params }) => {
    sessions.delete(params.sessionId)
    deleteSavedSession(params.sessionId)
    return {}
  })
  .onRequest('session/set_config_option', async ({ params, client }) => {
    const session = sessions.get(params.sessionId)
    const traceFile = process.env.MOCK_CONFIG_TRACE
    if (traceFile !== undefined)
      appendFileSync(traceFile, `${params.configId}:${params.value}\n`)
    if (params.configId === 'effort' || params.configId === 'thought_level') {
      if (!effortsOf(session.model).some(level => level.value === params.value))
        throw new Error(`unknown effort ${params.value}`)
      session.effort = params.value
    }
    else if (params.configId === 'style') {
      session.style = params.value
    }
    else if (params.configId === 'custom') {
      session.custom = params.value
    }
    else if (params.configId === 'mode-config') {
      session.mode = params.value
    }
    else {
      if (!MODELS.some(model => model.value === params.value))
        throw new Error(`unknown model ${params.value}`)
      session.model = params.value
      session.effort = defaultEffortOf(session.model)
    }
    persistSession(params.sessionId, session)
    if (process.env.MOCK_NOTIFY_CONFIG === '1') {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'config_option_update', configOptions: configOptions(session) },
      })
    }
    if (params.configId === 'model' && process.env.MOCK_UPDATE_DURING_SELECT === '1') {
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'current_mode_update', currentModeId: 'plan' },
      })
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: 'available_commands_update', availableCommands: [
          { name: 'during-select', description: 'Sent during initial model selection', input: { hint: 'selected' } },
        ] },
      })
    }
    return { configOptions: configOptions(session) }
  })
  .onRequest('session/set_mode', async ({ params, client }) => {
    const session = sessions.get(params.sessionId)
    session.mode = params.modeId
    persistSession(params.sessionId, session)
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'current_mode_update', currentModeId: params.modeId },
    })
    return {}
  })
  .onRequest('session/prompt', ({ params, client }) => prompt(params, client))
  .onNotification('session/cancel', ({ params }) => {
    const session = sessions.get(params.sessionId)
    if (session !== undefined)
      session.cancelled = true
  })
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
