import type {
  ContentBlock as AcpContentBlock,
  ClientConnection,
  InitializeResponse,
  LoadSessionResponse,
  McpServer,
  NewSessionResponse,
  PromptResponse,
  SessionConfigOption,
  SessionModeState,
  AvailableCommand,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
} from '@agentclientprotocol/sdk'
import type { ChildProcess } from 'node:child_process'
import type { AcpAgentProfile } from '../../shared/types.ts'
import type { HostLogger } from '../types/index.ts'
import type { AcpPromptCapabilities } from './prompt-capabilities.ts'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import process from 'node:process'
import { Readable, Writable } from 'node:stream'
import { client as createClientApp, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { PLUGIN_ID } from '../../shared/constants.ts'
import { DEFAULT_MODEL_ID } from '../config/constants.ts'
import { installedMcpServers } from './mcp-servers.ts'
import { promptCapabilitiesOf } from './prompt-capabilities.ts'

export interface AcpAdvertisedModel {
  id: string
  name: string
  description?: string
}

export interface AcpSessionModels {
  configId?: string
  legacy: boolean
  current?: string
  available: AcpAdvertisedModel[]
}

/** The agent's `thought_level` config option, mapped onto dsh reasoning efforts. */
export interface AcpSessionEfforts {
  configId: string
  current?: string
  /** The level the session started with: what dsh's "Default" effort restores. */
  initial?: string
  available: AcpAdvertisedModel[]
}

export interface AcpSession {
  sessionId: string
  generation: number
  models: AcpSessionModels
  efforts?: AcpSessionEfforts
  configOptions: SessionConfigOption[]
  modes?: SessionModeState
  availableCommands: AvailableCommand[]
  protocolVersion: number
  recovery: 'new' | 'loaded'
}

export type AcpPermissionHandler = (generation: number, sessionId: string, request: RequestPermissionRequest) => Promise<RequestPermissionResponse>

export interface AcpAgentOptions {
  route: string
  profile: () => AcpAgentProfile
  onPermission: AcpPermissionHandler
  logger: HostLogger
  /** Every completed handshake, so the caller can remember what this agent accepts. */
  onCapabilities?: (capabilities: AcpPromptCapabilities) => void
}

interface LiveAgent {
  child: ChildProcess
  connection: ClientConnection
  init: InitializeResponse
  generation: number
}

interface LegacyModels {
  currentModelId?: string
  availableModels?: Array<{ modelId: string, name?: string, description?: string | null }>
}

type ConfigOptionUpdate = Extract<SessionUpdate, { sessionUpdate: 'config_option_update' }>
type CurrentModeUpdate = Extract<SessionUpdate, { sessionUpdate: 'current_mode_update' }>
type AvailableCommandsUpdate = Extract<SessionUpdate, { sessionUpdate: 'available_commands_update' }>

interface InitialSessionUpdates {
  config?: ConfigOptionUpdate
  mode?: CurrentModeUpdate
  commands?: AvailableCommandsUpdate
}

const AUTH_REQUIRED_CODE = -32000

const STDERR_TAIL_BYTES = 4096

function selectOption(options: readonly SessionConfigOption[] | null | undefined, category: string): { id: string, current: string, available: AcpAdvertisedModel[] } | undefined {
  const option = options?.find(item => item.category === category && item.type === 'select')
    ?? options?.find(item => item.id === category && item.type === 'select')
  if (option === undefined || option.type !== 'select')
    return undefined
  const available = option.options.flatMap(entry => 'group' in entry ? entry.options : [entry])
    .map(entry => ({ id: entry.value, name: entry.name, ...entry.description ? { description: entry.description } : {} }))
  return { id: option.id, current: option.currentValue, available }
}

/** Read the `thought_level` select the agent offers, if any. */
export function sessionEfforts(options: readonly SessionConfigOption[] | null | undefined): AcpSessionEfforts | undefined {
  const option = selectOption(options, 'thought_level')
  return option === undefined || option.available.length === 0 ? undefined : { configId: option.id, current: option.current, initial: option.current, available: option.available }
}

/** Fold a fresh `configOptions` list (set_config_option answer or config_option_update) into a session. */
export function applyConfigOptions(session: AcpSession, options: readonly SessionConfigOption[] | null | undefined, resetEffortInitial = false): void {
  if (options === undefined)
    return
  session.configOptions = options === null ? [] : [...options]
  const model = selectOption(options, 'model')
  if (model !== undefined) {
    session.models = { configId: model.id, legacy: false, current: model.current, available: model.available }
  }
  else if (!session.models.legacy) {
    session.models = { legacy: false, available: [] }
  }
  const efforts = sessionEfforts(options)
  if (efforts !== undefined) {
    const initial = resetEffortInitial ? efforts.initial : session.efforts?.initial ?? efforts.initial
    session.efforts = { ...efforts, ...initial === undefined ? {} : { initial } }
  }
  else
    delete session.efforts
}

export function sessionModels(response: NewSessionResponse): AcpSessionModels {
  const option = selectOption(response.configOptions, 'model')
  if (option !== undefined)
    return { configId: option.id, legacy: false, current: option.current, available: option.available }
  const legacy = Reflect.get(response, 'models') as LegacyModels | null | undefined
  if (legacy?.availableModels !== undefined) {
    return {
      legacy: true,
      ...legacy.currentModelId === undefined ? {} : { current: legacy.currentModelId },
      available: legacy.availableModels.map(entry => ({
        id: entry.modelId,
        name: entry.name ?? entry.modelId,
        ...entry.description ? { description: entry.description } : {},
      })),
    }
  }
  return { legacy: false, available: [] }
}

function describeError(error: unknown): string {
  if (error instanceof Error)
    return error.message
  if (typeof error === 'object' && error !== null && typeof Reflect.get(error, 'message') === 'string')
    return Reflect.get(error, 'message') as string
  return String(error)
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
}

function abortError(): LlmError {
  return new LlmError('ACP request was aborted', 'ABORTED')
}

export class AcpAgentProcess {
  private live: LiveAgent | undefined
  private starting: Promise<LiveAgent> | undefined
  private generationCounter = 0
  private disposed = false
  private stderrTail = ''
  private readonly listeners = new Map<string, (update: SessionUpdate) => void>()
  private readonly pendingInitialSessions = new Set<string>()
  private readonly initialSessionUpdates = new Map<string, InitialSessionUpdates>()
  private pendingNewSessions = 0
  private advertised: AcpAdvertisedModel[] | undefined
  private discovering: Promise<readonly AcpAdvertisedModel[]> | undefined
  /** In-flight effort probes, keyed like `modelEfforts`, so concurrent asks share one probe. */
  private readonly discoveringEfforts = new Map<string, Promise<AcpSessionEfforts | undefined>>()
  /** The single session every effort probe reuses; created on demand, never prompted. */
  private probeSession: AcpSession | undefined
  private probeCwd: string | undefined
  /** Serializes probe work so two models never drive the shared probe session at once. */
  private probeQueue: Promise<void> = Promise.resolve()
  private readonly modelEfforts = new Map<string, AcpSessionEfforts | undefined>()

  constructor(private readonly options: AcpAgentOptions) {}

  get generation(): number {
    return this.live?.generation ?? -1
  }

  /** What the running agent said it accepts in a prompt; undefined until it has spoken. */
  get promptCapabilities(): AcpPromptCapabilities | undefined {
    const live = this.live
    return live === undefined ? undefined : promptCapabilitiesOf(live.init.agentCapabilities?.promptCapabilities)
  }

  get supportsImages(): boolean {
    return this.promptCapabilities?.image === true
  }

  /** Whether the running agent can replay a recorded session; false before it has spoken. */
  get supportsLoadSession(): boolean {
    const live = this.live
    return live !== undefined && live.init.agentCapabilities?.loadSession === true
  }

  /**
   * Ask the agent itself what prompt content it accepts. ACP answers that in `initialize`,
   * so the handshake alone is enough — no session and no turn.
   */
  async probeCapabilities(signal?: AbortSignal): Promise<AcpPromptCapabilities> {
    const live = await this.ensure(signal)
    return promptCapabilitiesOf(live.init.agentCapabilities?.promptCapabilities)
  }

  get advertisedModels(): readonly AcpAdvertisedModel[] | undefined {
    return this.advertised
  }

  /**
   * Start one ACP session in `cwd`.
   *
   * @param cwd - working directory the agent builds in.
   * @param signal - cancels the `session/new` request.
   * @param mcpServers - servers to offer the agent; omitted means the servers the host
   *   forwards for this route. A route with `forwardMcp: false` offers none either way.
   * @returns the session id, its models, and its reasoning efforts when it advertises any.
   */
  async newSession(cwd: string, signal?: AbortSignal, mcpServers?: readonly McpServer[]): Promise<AcpSession> {
    const live = await this.ensure(signal)
    const forwarded = this.options.profile().forwardMcp === false ? [] : mcpServers ?? installedMcpServers()
    let response: NewSessionResponse
    this.pendingNewSessions++
    try {
      try {
        response = await this.withAbort(live.connection.agent.request(methods.agent.session.new, { cwd, mcpServers: [...forwarded] }), signal)
      }
      catch (error) {
        if (error instanceof LlmError)
          throw error
        if (errorCode(error) === AUTH_REQUIRED_CODE) {
          const available = (live.init.authMethods ?? []).map(method => method.id).join(', ')
          throw new LlmError(
            `${PLUGIN_ID}: ACP agent "${this.options.route}" requires authentication; sign in with the agent's own CLI or set authMethod${available.length > 0 ? ` (one of: ${available})` : ''} — ${describeError(error)}`,
            'MISSING_CREDENTIAL',
            { cause: error },
          )
        }
        throw this.transportError('session/new', error)
      }
      const models = sessionModels(response)
      if (models.available.length > 0)
        this.advertised = models.available
      const efforts = sessionEfforts(response.configOptions)
      const session: AcpSession = {
        sessionId: response.sessionId,
        generation: live.generation,
        models,
        ...efforts === undefined ? {} : { efforts },
        configOptions: response.configOptions ?? [],
        ...response.modes == null ? {} : { modes: response.modes },
        availableCommands: [],
        protocolVersion: live.init.protocolVersion,
        recovery: 'new',
      }
      this.pendingInitialSessions.add(session.sessionId)
      this.applyInitialSessionUpdates(session)
      return session
    }
    finally {
      this.pendingNewSessions--
      this.pruneInitialSessionUpdates()
    }
  }

  async loadSession(sessionId: string, cwd: string, signal?: AbortSignal, onUpdate?: (update: SessionUpdate) => void): Promise<AcpSession | undefined> {
    const live = await this.ensure(signal)
    if (live.init.agentCapabilities?.loadSession !== true)
      return undefined
    const forwarded = this.options.profile().forwardMcp === false ? [] : installedMcpServers()
    let response: LoadSessionResponse | void
    const previousListener = this.listeners.get(sessionId)
    if (onUpdate !== undefined)
      this.listeners.set(sessionId, onUpdate)
    try {
      response = await this.withAbort(live.connection.agent.request(methods.agent.session.load, {
        sessionId,
        cwd,
        mcpServers: [...forwarded],
      }), signal)
    }
    catch (error) {
      if (error instanceof LlmError)
        throw error
      throw this.transportError('session/load', error)
    }
    finally {
      if (onUpdate !== undefined && this.listeners.get(sessionId) === onUpdate) {
        if (previousListener === undefined)
          this.listeners.delete(sessionId)
        else
          this.listeners.set(sessionId, previousListener)
      }
    }
    this.pendingInitialSessions.add(sessionId)
    const models = sessionModels({ sessionId, configOptions: response?.configOptions })
    const efforts = sessionEfforts(response?.configOptions)
    return {
      sessionId,
      generation: live.generation,
      models,
      ...efforts === undefined ? {} : { efforts },
      configOptions: response?.configOptions ?? [],
      ...response?.modes == null ? {} : { modes: response.modes },
      availableCommands: [],
      protocolVersion: live.init.protocolVersion,
      recovery: 'loaded',
    }
  }

  async selectModel(session: AcpSession, model: string, signal?: AbortSignal): Promise<void> {
    if (model === DEFAULT_MODEL_ID || model === session.models.current)
      return
    const live = this.requireLive(session.generation)
    const { configId, legacy } = session.models
    try {
      if (configId !== undefined) {
        await this.setConfigOption(session, configId, model, signal, true)
      }
      else if (legacy) {
        await this.withAbort(live.connection.agent.request('session/set_model', { sessionId: session.sessionId, modelId: model }), signal)
        session.models.current = model
      }
      else {
        throw new LlmError(
          `${PLUGIN_ID}: ACP agent "${this.options.route}" does not expose model selection; use model "${DEFAULT_MODEL_ID}"`,
          'MODEL_NOT_FOUND',
        )
      }
    }
    catch (error) {
      if (error instanceof LlmError && error.code !== 'INVALID_REQUEST')
        throw error
      throw new LlmError(
        `${PLUGIN_ID}: ACP agent "${this.options.route}" rejected model "${model}": ${describeError(error)}`,
        'MODEL_NOT_FOUND',
        { cause: error },
      )
    }
    if (configId !== undefined && session.models.current !== model)
      throw new LlmError(`${PLUGIN_ID}: ACP agent "${this.options.route}" confirmed model "${session.models.current ?? 'unknown'}" instead of "${model}"`, 'MODEL_NOT_FOUND')
  }

  async setConfigOption(session: AcpSession, configId: string, value: string, signal?: AbortSignal, resetEffortInitial = false): Promise<void> {
    const live = this.requireLive(session.generation)
    try {
      const response = await this.withAbort(live.connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId: session.sessionId,
        configId,
        value,
      }), signal)
      applyConfigOptions(session, response.configOptions, resetEffortInitial)
    }
    catch (error) {
      if (error instanceof LlmError)
        throw error
      throw new LlmError(`${PLUGIN_ID}: ACP agent "${this.options.route}" rejected configuration "${configId}": ${describeError(error)}`, 'INVALID_REQUEST', { cause: error })
    }
  }

  async setMode(session: AcpSession, modeId: string, signal?: AbortSignal): Promise<void> {
    const live = this.requireLive(session.generation)
    try {
      await this.withAbort(live.connection.agent.request(methods.agent.session.setMode, {
        sessionId: session.sessionId,
        modeId,
      }), signal)
      if (session.modes !== undefined)
        session.modes = { ...session.modes, currentModeId: modeId }
    }
    catch (error) {
      if (error instanceof LlmError)
        throw error
      throw new LlmError(`${PLUGIN_ID}: ACP agent "${this.options.route}" rejected mode "${modeId}": ${describeError(error)}`, 'INVALID_REQUEST', { cause: error })
    }
  }

  /**
   * Apply a dsh reasoning effort through the agent's `thought_level` option. Unknown efforts
   * (the model changed the offered levels) keep the agent's current level.
   */
  async selectEffort(session: AcpSession, effort: string, signal?: AbortSignal): Promise<void> {
    const efforts = session.efforts
    if (efforts === undefined || efforts.current === effort)
      return
    if (!efforts.available.some(level => level.id === effort)) {
      this.options.logger.warn(`${PLUGIN_ID}: ACP agent "${this.options.route}" does not offer reasoning effort "${effort}"; keeping "${efforts.current ?? 'default'}"`)
      return
    }
    const live = this.requireLive(session.generation)
    try {
      await this.setConfigOption(session, efforts.configId, effort, signal)
    }
    catch (error) {
      if (error instanceof LlmError)
        throw error
      throw new LlmError(`${PLUGIN_ID}: ACP agent "${this.options.route}" rejected reasoning effort "${effort}": ${describeError(error)}`, 'INVALID_REQUEST', { cause: error })
    }
  }

  private bufferInitialSessionUpdate(sessionId: string, update: SessionUpdate): void {
    if (this.pendingNewSessions === 0 && !this.pendingInitialSessions.has(sessionId))
      return
    let initial = this.initialSessionUpdates.get(sessionId)
    if (initial === undefined) {
      initial = {}
      this.initialSessionUpdates.set(sessionId, initial)
    }
    if (update.sessionUpdate === 'config_option_update')
      initial.config = update
    else if (update.sessionUpdate === 'current_mode_update')
      initial.mode = update
    else if (update.sessionUpdate === 'available_commands_update')
      initial.commands = update
  }

  private applyInitialSessionUpdates(session: AcpSession): void {
    const initial = this.initialSessionUpdates.get(session.sessionId)
    this.initialSessionUpdates.delete(session.sessionId)
    if (initial?.config !== undefined)
      applyConfigOptions(session, initial.config.configOptions)
    if (initial?.mode !== undefined) {
      session.modes = session.modes === undefined
        ? { currentModeId: initial.mode.currentModeId, availableModes: [] }
        : { ...session.modes, currentModeId: initial.mode.currentModeId }
    }
    if (initial?.commands !== undefined)
      session.availableCommands = [...initial.commands.availableCommands]
  }

  discardInitialSessionUpdates(sessionId: string): void {
    this.pendingInitialSessions.delete(sessionId)
    this.initialSessionUpdates.delete(sessionId)
  }

  private pruneInitialSessionUpdates(): void {
    if (this.pendingNewSessions > 0)
      return
    for (const sessionId of this.initialSessionUpdates.keys()) {
      if (!this.pendingInitialSessions.has(sessionId))
        this.initialSessionUpdates.delete(sessionId)
    }
  }

  listen(session: AcpSession, onUpdate: (update: SessionUpdate) => void): () => void {
    this.listeners.set(session.sessionId, onUpdate)
    this.pendingInitialSessions.delete(session.sessionId)
    const initial = this.initialSessionUpdates.get(session.sessionId)
    this.initialSessionUpdates.delete(session.sessionId)
    if (initial?.config !== undefined)
      onUpdate(initial.config)
    if (initial?.mode !== undefined)
      onUpdate(initial.mode)
    if (initial?.commands !== undefined)
      onUpdate(initial.commands)
    return () => {
      if (this.listeners.get(session.sessionId) === onUpdate)
        this.listeners.delete(session.sessionId)
    }
  }

  async prompt(session: AcpSession, prompt: AcpContentBlock[]): Promise<PromptResponse> {
    const live = this.requireLive(session.generation)
    try {
      return await live.connection.agent.request(methods.agent.session.prompt, { sessionId: session.sessionId, prompt })
    }
    catch (error) {
      throw this.transportError('session/prompt', error)
    }
  }

  cancel(session: AcpSession): void {
    const live = this.live
    if (live === undefined || live.generation !== session.generation)
      return
    void live.connection.agent.notify(methods.agent.session.cancel, { sessionId: session.sessionId }).catch(() => {})
  }

  closeSession(session: AcpSession): void {
    this.pendingInitialSessions.delete(session.sessionId)
    this.initialSessionUpdates.delete(session.sessionId)
    const live = this.live
    if (live === undefined || live.generation !== session.generation)
      return
    if (!Reflect.get(live.init.agentCapabilities?.sessionCapabilities ?? {}, 'close'))
      return
    void live.connection.agent.request(methods.agent.session.close, { sessionId: session.sessionId }).catch(() => {})
  }

  async discoverModels(cwd: string, signal?: AbortSignal): Promise<readonly AcpAdvertisedModel[]> {
    if (this.advertised !== undefined)
      return this.advertised
    // The probe session is shared with effort discovery and kept alive rather than closed:
    // `session/close` is optional in ACP, and on an agent that does not implement it a
    // throwaway session outlives the request and holds its MCP servers until the agent dies.
    // Discovery runs for every configured route on every start, so those leftovers add up.
    this.discovering ??= this.ensureProbeSession(this.generation, cwd).then((session) => {
      this.advertised ??= session.models.available
      return this.advertised
    }).catch((error: unknown) => {
      throw error
    }).finally(() => {
      this.discovering = undefined
    })
    return this.withAbort(this.discovering, signal)
  }

  async discoverEffortsForModel(model: string, cwd: string, signal?: AbortSignal): Promise<AcpSessionEfforts | undefined> {
    const live = await this.ensure(signal)
    const key = this.modelEffortKey(live.generation, cwd, model)
    if (this.modelEfforts.has(key))
      return this.modelEfforts.get(key)
    if (signal?.aborted)
      throw abortError()
    // Concurrent catalog reads ask about the same model at once; those share one probe.
    const inflight = this.discoveringEfforts.get(key)
    if (inflight !== undefined)
      return this.withAbort(inflight, signal)
    // Every distinct model has its own key, so same-key sharing alone leaves one probe per
    // model — and on an agent that backs a session with a process (claude-code-acp starts a
    // CLI per session) that is one process tree per model, none of which can be released
    // when the agent does not implement `session/close`. Reading one model's levels after
    // switching models is exactly what the protocol supports in a single session, so all
    // models share one long-lived probe, worked through one at a time.
    const discovery = this.probeEfforts(live.generation, cwd, model, signal).finally(() => {
      if (this.discoveringEfforts.get(key) === discovery)
        this.discoveringEfforts.delete(key)
    })
    this.discoveringEfforts.set(key, discovery)
    if (signal === undefined)
      return discovery
    // A caller that gives up must not leave its promise behind for the next caller to join:
    // it is already doomed, so re-probing has to start fresh instead of inheriting it.
    return new Promise<AcpSessionEfforts | undefined>((resolve, reject) => {
      const onAbort = (): void => {
        if (this.discoveringEfforts.get(key) === discovery)
          this.discoveringEfforts.delete(key)
        reject(abortError())
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      discovery.then(
        (value) => {
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        },
      )
    })
  }

  /**
   * Read one model's thought levels through the shared probe session, serialized so two
   * models never drive the same session at once.
   *
   * @param generation - agent generation the caller resolved its model against.
   * @param cwd - session working directory the probe is scoped to.
   * @param model - model whose `thought_level` option to read.
   * @param signal - cancels the caller's wait, not the shared probe itself.
   */
  private probeEfforts(generation: number, cwd: string, model: string, signal?: AbortSignal): Promise<AcpSessionEfforts | undefined> {
    const run = this.probeQueue.then(async (): Promise<AcpSessionEfforts | undefined> => {
      if (signal?.aborted)
        throw abortError()
      const session = await this.ensureProbeSession(generation, cwd)
      this.requireLive(session.generation)
      try {
        if (signal?.aborted)
          throw abortError()
        await this.selectModel(session, model, signal)
        this.requireLive(session.generation)
        if (signal?.aborted)
          throw abortError()
        const efforts = session.efforts === undefined ? undefined : { ...session.efforts, initial: session.efforts.current }
        this.rememberEfforts(session.generation, cwd, model, efforts)
        return efforts
      }
      catch (error) {
        // The probe session is left mid-switch when a caller gives up, and reusing it would
        // report the previous model's levels as this model's. Drop it so the next probe
        // starts clean instead of inheriting a half-applied model switch.
        if (signal?.aborted) {
          if (this.probeSession === session)
            this.discardProbeSession()
        }
        throw error
      }
    })
    // Keep the queue alive after a failure so later probes still run.
    this.probeQueue = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * The one probe session effort discovery reuses, created on first use.
   *
   * A probe reads metadata only: it never prompts, so it is offered no MCP servers, and it
   * is discarded when the agent restarts or the working directory changes.
   *
   * @param generation - agent generation the probe must belong to.
   * @param cwd - working directory the session is scoped to.
   */
  private async ensureProbeSession(generation: number, cwd: string): Promise<AcpSession> {
    const existing = this.probeSession
    if (existing !== undefined && existing.generation === generation && this.probeCwd === cwd)
      return existing
    if (existing !== undefined) {
      this.closeSession(existing)
      this.probeSession = undefined
      this.probeCwd = undefined
    }
    const session = await this.newSession(cwd, undefined, [])
    this.probeSession = session
    this.probeCwd = cwd
    return session
  }

  /** Drop the shared probe session, closing it when the agent supports that. */
  private discardProbeSession(): void {
    const session = this.probeSession
    this.probeSession = undefined
    this.probeCwd = undefined
    if (session !== undefined)
      this.closeSession(session)
  }

  knownEffortsForModel(model: string, cwd: string): AcpSessionEfforts | undefined {
    const generation = this.generation
    if (generation < 0)
      return undefined
    return this.modelEfforts.get(this.modelEffortKey(generation, cwd, model))
  }

  restart(): void {
    this.advertised = undefined
    this.discovering = undefined
    this.discardProbeSession()
    this.discoveringEfforts.clear()
    this.modelEfforts.clear()
    this.teardown()
  }

  dispose(): void {
    this.disposed = true
    this.discardProbeSession()
    this.discoveringEfforts.clear()
    this.modelEfforts.clear()
    this.teardown()
  }

  private teardown(): void {
    const live = this.live
    this.live = undefined
    this.starting = undefined
    this.listeners.clear()
    this.pendingInitialSessions.clear()
    this.initialSessionUpdates.clear()
    if (live === undefined)
      return
    live.connection.close()
    live.child.stdin?.end()
    this.killTree(live.child, 'SIGTERM')
  }

  /**
   * Signal the agent *and everything it spawned*.
   *
   * The agent starts its MCP servers as grandchildren, and those do not go away when
   * the agent itself is signalled — they outlive it as orphans. Because the child was
   * spawned `detached`, it leads its own process group, so a negative pid reaches the
   * whole tree. Windows has no process-group signal here, so it falls back to the
   * single-pid kill this replaced.
   *
   * @param child - the agent process spawned by this instance.
   * @param signal - signal to deliver to the group.
   */
  private killTree(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.exitCode !== null || child.signalCode !== null)
      return
    if (process.platform !== 'win32' && child.pid !== undefined) {
      try {
        process.kill(-child.pid, signal)
        return
      }
      catch {
        // The group is already gone, or `detached` did not take effect; fall through
        // to the direct kill so a single doomed child is still signalled.
      }
    }
    child.kill(signal)
  }

  private requireLive(generation: number): LiveAgent {
    const live = this.live
    if (live === undefined || live.generation !== generation)
      throw new LlmError(`${PLUGIN_ID}: ACP agent "${this.options.route}" restarted during the request`, 'TRANSPORT')
    return live
  }

  private modelEffortKey(generation: number, cwd: string, model: string): string {
    return JSON.stringify([generation, cwd, model])
  }

  private rememberEfforts(generation: number, cwd: string, model: string, efforts: AcpSessionEfforts | undefined): void {
    if (this.generation !== generation)
      return
    const key = this.modelEffortKey(generation, cwd, model)
    if (!this.modelEfforts.has(key))
      this.modelEfforts.set(key, efforts)
  }

  private ensure(signal?: AbortSignal): Promise<LiveAgent> {
    if (this.disposed)
      return Promise.reject(new LlmError(`${PLUGIN_ID}: ACP agent "${this.options.route}" was disposed`, 'TRANSPORT'))
    if (this.live !== undefined)
      return Promise.resolve(this.live)
    this.starting ??= this.start().finally(() => {
      this.starting = undefined
    })
    return this.withAbort(this.starting, signal)
  }

  private async start(): Promise<LiveAgent> {
    const profile = this.options.profile()
    const generation = ++this.generationCounter
    this.modelEfforts.clear()
    this.stderrTail = ''
    const child = spawn(profile.command, profile.args, {
      cwd: profile.cwd ?? homedir(),
      env: { ...process.env, ...profile.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32',
      // Lead its own process group so `killTree` can signal the whole tree. Real agents
      // start their MCP servers one level below this process; a single-pid kill leaves
      // those grandchildren running, which is how orphaned MCP servers accumulate.
      detached: process.platform !== 'win32',
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_BYTES)
    })
    const exited = new Promise<never>((_, reject) => {
      child.once('error', error => reject(this.startError(`failed to spawn "${profile.command}": ${error.message}`, error)))
      child.once('exit', (code, sig) => reject(this.startError(`agent exited during startup (code ${code ?? 'null'}, signal ${sig ?? 'null'})`)))
    })
    exited.catch(() => {})

    const app = createClientApp({ name: PLUGIN_ID })
      .onNotification(methods.client.session.update, ({ params }) => {
        const listener = this.listeners.get(params.sessionId)
        if (listener !== undefined)
          listener(params.update)
        else
          this.bufferInitialSessionUpdate(params.sessionId, params.update)
        return Promise.resolve()
      })
      .onRequest(methods.client.session.requestPermission, ({ params }) => this.options.onPermission(generation, params.sessionId, params))
    const connection = app.connect(ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    ))

    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(this.startError(`initialize timed out after ${profile.startupTimeoutMs}ms`)), profile.startupTimeoutMs)
    })
    let init: InitializeResponse
    try {
      init = await Promise.race([
        connection.agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: PLUGIN_ID, version: '0.2.0' },
        }),
        exited,
        timeout,
      ])
    }
    catch (error) {
      connection.close()
      this.killTree(child, 'SIGKILL')
      throw error instanceof LlmError ? error : this.startError(`initialize failed: ${describeError(error)}`, error)
    }
    finally {
      clearTimeout(timer)
    }

    if (profile.authMethod !== undefined) {
      try {
        await Promise.race([connection.agent.request(methods.agent.authenticate, { methodId: profile.authMethod }), exited])
      }
      catch (error) {
        connection.close()
        this.killTree(child, 'SIGKILL')
        const available = (init.authMethods ?? []).map(method => method.id).join(', ')
        throw new LlmError(
          `${PLUGIN_ID}: ACP agent "${this.options.route}" rejected authMethod "${profile.authMethod}"${available.length > 0 ? ` (available: ${available})` : ''}: ${describeError(error)}${this.stderrSuffix()}`,
          'MISSING_CREDENTIAL',
          { cause: error },
        )
      }
    }

    const live: LiveAgent = { child, connection, init, generation }
    child.removeAllListeners('exit')
    child.once('exit', (code, sig) => {
      if (this.live === live) {
        this.options.logger.warn(`${PLUGIN_ID}: ACP agent "${this.options.route}" exited (code ${code ?? 'null'}, signal ${sig ?? 'null'})${this.stderrSuffix()}`)
        this.live = undefined
        this.listeners.clear()
        connection.close()
      }
    })
    this.live = live
    this.options.onCapabilities?.(promptCapabilitiesOf(init.agentCapabilities?.promptCapabilities))
    return live
  }

  private stderrSuffix(): string {
    const tail = this.stderrTail.trim()
    return tail.length === 0 ? '' : `\n${tail}`
  }

  private startError(message: string, cause?: unknown): LlmError {
    return new LlmError(
      `${PLUGIN_ID}: ACP agent "${this.options.route}" ${message}${this.stderrSuffix()}`,
      'TRANSPORT',
      cause === undefined ? undefined : { cause },
    )
  }

  private transportError(stage: string, error: unknown): LlmError {
    if (error instanceof LlmError)
      return error
    return new LlmError(
      `${PLUGIN_ID}: ACP agent "${this.options.route}" ${stage} failed: ${describeError(error)}${this.stderrSuffix()}`,
      'TRANSPORT',
      { cause: error },
    )
  }

  private withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal === undefined)
      return promise
    if (signal.aborted)
      return Promise.reject(abortError())
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(abortError())
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
    })
  }
}
