import type { SessionConfigOption, SessionUpdate } from '@agentclientprotocol/sdk'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { client as createClientApp, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const STARTUP_TIMEOUT_MS = 60_000
const REQUEST_TIMEOUT_MS = 30_000
const CLOSE_TIMEOUT_MS = 2_000
const CHILD_STOP_TIMEOUT_MS = 1_000
const SENSITIVE_LABEL = /(?:auth(?:entication|orization)?|credential|secret|token|password|api[-_ ]?key)/i

export interface SmokeArguments {
  command: string
  args: string[]
  prompt?: string
}

export interface SmokeDiagnosticOptions {
  command: string
  args: readonly string[]
  authMethod?: string
  env?: NodeJS.ProcessEnv
  /** Allows lifecycle tests to verify that the temporary working directory is removed. */
  tempRoot?: string
}

export interface SmokeReport {
  protocol: number
  agent: { name: string, version?: string } | null
  capabilities: {
    loadSession: boolean
    prompt: { image: boolean, audio: boolean, embeddedContext: boolean }
    mcp: { http: boolean, sse: boolean, acp: boolean }
    session: { close: boolean }
  }
  options: Array<{
    id: string
    name: string
    category?: string
    type: 'select' | 'boolean'
    currentValue?: string | boolean
    values?: string[]
  }>
  modes: { currentModeId: string, availableModes: Array<{ id: string, name: string }> } | null
  /** Null means no command notification had arrived when the probe snapshot was taken. */
  commands: string[] | null
}

export function parseSmokeArgs(argv: readonly string[]): SmokeArguments | undefined {
  const separator = argv.indexOf('--')
  const commandAndArgs = separator === -1 ? argv : argv.slice(0, separator)
  const [command, ...args] = commandAndArgs
  if (command === undefined)
    return undefined
  const prompt = separator === -1 ? undefined : argv.slice(separator + 1).join(' ')
  return { command, args, ...(prompt === undefined ? {} : { prompt }) }
}

function isSensitiveLabel(value: string | null | undefined): boolean {
  return value !== undefined && value !== null && SENSITIVE_LABEL.test(value)
}

function safeOption(option: SessionConfigOption): SmokeReport['options'][number] | undefined {
  if (isSensitiveLabel(option.id) || isSensitiveLabel(option.name) || isSensitiveLabel(option.category))
    return undefined

  const base = {
    id: option.id,
    name: option.name,
    ...option.category == null ? {} : { category: option.category },
  }
  if (option.type === 'boolean')
    return { ...base, type: 'boolean', currentValue: option.currentValue }

  // Select values are useful for the standard model/mode/reasoning selectors. Keep
  // custom selectors to their labels because their values can contain private data.
  const safeCategory = option.category === 'model' || option.category === 'mode' || option.category === 'thought_level'
  if (!safeCategory)
    return { ...base, type: 'select' }

  const entries = option.options.flatMap(entry => 'group' in entry ? entry.options : [entry])
  if ([option.currentValue, ...entries.map(entry => entry.value)].some(isSensitiveLabel))
    return { ...base, type: 'select' }
  return {
    ...base,
    type: 'select',
    currentValue: option.currentValue,
    values: entries.map(entry => entry.value),
  }
}

function reportOptions(options: readonly SessionConfigOption[] | null | undefined): SmokeReport['options'] {
  return options?.flatMap(option => {
    const safe = safeOption(option)
    return safe === undefined ? [] : [safe]
  }) ?? []
}

function childExit(child: ChildProcess): Promise<never> {
  return new Promise((_, reject) => {
    child.once('error', () => reject(new Error('agent process failed to start')))
    child.once('exit', () => reject(new Error('agent process exited')))
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function requestWhileRunning<T>(
  request: Promise<T>,
  exited: Promise<never>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([request, exited, timeout]).finally(() => clearTimeout(timer))
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(true)

  return new Promise((resolve) => {
    const finish = (exited: boolean) => {
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      child.removeListener('error', onError)
      resolve(exited)
    }
    const onExit = () => finish(true)
    const onError = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return
  try {
    child.kill('SIGTERM')
  }
  catch {}
  if (await waitForChildExit(child, CHILD_STOP_TIMEOUT_MS))
    return
  try {
    child.kill('SIGKILL')
  }
  catch {}
  await waitForChildExit(child, CHILD_STOP_TIMEOUT_MS)
}

export async function inspectAgent(options: SmokeDiagnosticOptions): Promise<SmokeReport> {
  const cwd = mkdtempSync(join(options.tempRoot ?? tmpdir(), 'dsh-acp-smoke-'))
  let child: ChildProcess | undefined
  let connection: ReturnType<ReturnType<typeof createClientApp>['connect']> | undefined
  let sessionId: string | undefined
  let closeSupported = false
  let commands: string[] | null = null

  try {
    child = spawn(options.command, [...options.args], {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32',
    })
    child.stderr?.resume()
    const exited = childExit(child)
    exited.catch(() => {})
    if (child.stdin === null || child.stdout === null)
      throw new Error('agent process has no stdio')

    const app = createClientApp({ name: 'dsh-acp-smoke' })
      .onNotification(methods.client.session.update, ({ params }) => {
        const update: SessionUpdate = params.update
        if (update.sessionUpdate === 'available_commands_update')
          commands = update.availableCommands.map(command => command.name)
        return Promise.resolve()
      })
    connection = app.connect(ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ))

    const initialized = await requestWhileRunning(
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: 'dsh-acp-smoke', version: '0.1.0' },
      }),
      exited,
      STARTUP_TIMEOUT_MS,
      'initialize timed out',
    )
    closeSupported = initialized.agentCapabilities?.sessionCapabilities?.close != null

    if (options.authMethod !== undefined && options.authMethod.length > 0) {
      await requestWhileRunning(
        connection.agent.request(methods.agent.authenticate, { methodId: options.authMethod }),
        exited,
        REQUEST_TIMEOUT_MS,
        'authenticate timed out',
      )
    }

    const session = await requestWhileRunning(
      connection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] }),
      exited,
      REQUEST_TIMEOUT_MS,
      'session/new timed out',
    )
    sessionId = session.sessionId
    const advertised = initialized.agentCapabilities
    return {
      protocol: initialized.protocolVersion,
      agent: initialized.agentInfo == null
        ? null
        : {
            name: initialized.agentInfo.name,
            ...initialized.agentInfo.version === undefined ? {} : { version: initialized.agentInfo.version },
          },
      capabilities: {
        loadSession: advertised?.loadSession ?? false,
        prompt: {
          image: advertised?.promptCapabilities?.image ?? false,
          audio: advertised?.promptCapabilities?.audio ?? false,
          embeddedContext: advertised?.promptCapabilities?.embeddedContext ?? false,
        },
        mcp: {
          http: advertised?.mcpCapabilities?.http ?? false,
          sse: advertised?.mcpCapabilities?.sse ?? false,
          acp: advertised?.mcpCapabilities?.acp ?? false,
        },
        session: { close: closeSupported },
      },
      options: reportOptions(session.configOptions),
      modes: session.modes == null
        ? null
        : {
            currentModeId: session.modes.currentModeId,
            availableModes: session.modes.availableModes.map(({ id, name }) => ({ id, name })),
          },
      commands,
    }
  }
  finally {
    if (connection !== undefined && sessionId !== undefined && closeSupported) {
      await withTimeout(
        connection.agent.request(methods.agent.session.close, { sessionId }),
        CLOSE_TIMEOUT_MS,
        'session/close timed out',
      ).catch(() => {})
    }
    connection?.close()
    if (child !== undefined)
      await stopChild(child)
    rmSync(cwd, { recursive: true, force: true })
  }
}
