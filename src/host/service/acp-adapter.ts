import type { AvailableCommand, ContentBlock as AcpContentBlock, McpServer, PromptResponse, SessionConfigOption, SessionModeState, SessionUpdate, Usage } from '@agentclientprotocol/sdk'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ModelModality,
  ReasoningEffortId,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { AcpAgentProfile } from '../../shared/types.ts'
import type { AcpSessionCommand, AcpSessionConfigChoice, AcpSessionControl, AcpSessionMode, AcpSessionSelectConfigOption, AcpSessionSnapshot, AcpSessionTurnState } from '../../shared/session-control.ts'
import type { AcpRecordSink, AdapterHost } from '../types/index.ts'
import type { AcpAdvertisedModel, AcpSession, AcpSessionEfforts } from './acp-agent.ts'
import type { AcpPromptCapabilities } from './prompt-capabilities.ts'
import type { PromptImage, PromptImages } from './transcript.ts'
import type { PermissionTurn } from './permission.ts'
import type { AcpBindingRecord, AcpBindingStore, AcpPendingTurn } from './session-store.ts'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { LlmAdapter, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PLUGIN_ID } from '../../shared/constants.ts'
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MODEL_ID } from '../config/constants.ts'
import { AcpAgentProcess, applyConfigOptions } from './acp-agent.ts'
import { MemoryAcpBindingStore } from './session-store.ts'
import { SessionCoordinator } from './session-coordinator.ts'
import { ChunkTranslator, usageDelta } from './chunk-translator.ts'
import { createTurnSettlement, unknownTurnRefusal } from '../domain/turn.ts'
import { ContextWindows, inferContextWindow } from './context-windows.ts'
import { decidePermission, permissionOutcome } from './permission.ts'
import { PromptCapabilitiesCache } from './prompt-capabilities.ts'
import { consumedIds, conversationOf, fullPrompt, incrementalPrompt, systemText } from './transcript.ts'

interface Binding {
  provider: string
  dshSessionId: string | undefined
  session?: AcpSession
  cwd: string
  model: string
  consumed: string[]
  usage: Usage | undefined
  settingsRevision: number
  acpSessionId?: string
  protocolVersion: number
  spawnFactsHash: string
  replayBarrierIds: string[]
  needsFreshInput: boolean
  pending?: AcpPendingTurn
  turnState: AcpSessionTurnState
  revision: number
  recovery: 'new' | 'loaded'
  persistQueue?: Promise<void>
  unlisten?: () => void
  activeTurn?: ActiveTurn
}

interface ActiveTurn {
  agent: AcpAgentProcess
  session: AcpSession
  dshSessionId: string | undefined
  controller: AbortController
  recording?: AcpRecordSink
  queue: StreamChunk[]
  translator: ChunkTranslator
  notify: () => void
  model: string
  usageBefore: Usage | undefined
  suppressUsage: boolean
  binding: Binding
  pendingId?: string
  settlement?: Promise<void>
  promptSettled: boolean
  finished: boolean
}

const TEXT_ONLY: readonly ModelModality[] = ['text']

const TEXT_AND_IMAGE: readonly ModelModality[] = ['text', 'image']

type Outcome =
  | { kind: 'response', response: PromptResponse }
  | { kind: 'error', error: unknown }
  | { kind: 'aborted' }
  | { kind: 'timeout' }

const NO_RETRY = { mode: 'normal', maxRetries: 0 } as const

const CANCEL_GRACE_MS = 5_000

/**
 * Coordinator key for a route's ephemeral work.
 *
 * Namespaced so a burst of compaction or title requests queues behind itself instead of
 * behind (or ahead of) the user's conversation. `\0` cannot appear in a provider or DSH
 * session id, so it cannot collide with a real binding key.
 */
function ephemeralKeyOf(route: string): string {
  return `\u0000ephemeral\u0000${route}`
}

function spawnFacts(profile: AcpAgentProfile): string {
  return JSON.stringify([profile.command, profile.args, profile.env, profile.cwd ?? null, profile.authMethod ?? null])
}

function failure(code: string, message: string): { code: string, message: string } {
  return { code, message }
}

function failureOf(error: unknown): { code: string, message: string } {
  const known = typeof error === 'object' && error !== null ? Reflect.get(error, 'failure') as { code?: unknown, message?: unknown } | undefined : undefined
  if (typeof known?.code === 'string' && typeof known.message === 'string')
    return failure(known.code, known.message)
  return failure('TRANSPORT', error instanceof Error ? error.message : String(error))
}

/** One model entry as it arrived from configuration or an external agent, before validation. */
interface ModelCandidate {
  readonly id?: unknown
  readonly name?: unknown
  readonly description?: unknown
}

/**
 * A protocol value dsh may echo back to the agent: non-empty and not blank. The original
 * string is preserved because it is also the value sent in `session/set_config_option`;
 * a whitespace-padded id still names a real option.
 */
function protocolValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/** A trimmed human-readable string, or undefined when the candidate sent none. */
function displayText(value: unknown): string | undefined {
  if (typeof value !== 'string')
    return undefined
  const text = value.trim()
  return text.length > 0 ? text : undefined
}

/** A context window dsh's registry accepts: a positive safe integer. */
function validWindow(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/**
 * Map configured or agent-advertised candidates onto dsh's model-catalog contract.
 * ACP agents are not obliged to return a clean list: claude-code-acp advertises its own
 * `default` model, which collides with the synthetic default this adapter prepends, and
 * other agents may send blank ids, duplicate ids or empty names. dsh rejects the whole
 * catalog on one bad entry, so clean deterministically at this boundary: drop blank ids,
 * keep the first entry per id, fall back to the id when the name is missing, and drop
 * unusable descriptions. Order is preserved.
 */
function cleanModels(provider: string, candidates: readonly ModelCandidate[], modalities: { inputModalities?: readonly ModelModality[] }): LlmModelInfo[] {
  const seen = new Set<string>()
  const models: LlmModelInfo[] = []
  for (const candidate of candidates) {
    const id = protocolValue(candidate.id)
    if (id === undefined || seen.has(id))
      continue
    seen.add(id)
    const description = displayText(candidate.description)
    models.push({
      provider,
      id,
      name: displayText(candidate.name) ?? id,
      ...description === undefined ? {} : { description },
      ...modalities,
    })
  }
  return models
}

/** The same cleanup as {@link cleanModels}, for the settings-side advertised list. */
function cleanAdvertisedModels(candidates: readonly AcpAdvertisedModel[]): AcpAdvertisedModel[] {
  const seen = new Set<string>()
  const models: AcpAdvertisedModel[] = []
  for (const candidate of candidates) {
    const id = protocolValue(candidate.id)
    if (id === undefined || seen.has(id))
      continue
    seen.add(id)
    const description = displayText(candidate.description)
    models.push({ id, name: displayText(candidate.name) ?? id, ...description === undefined ? {} : { description } })
  }
  return models
}

function sessionConfigChoices(options: readonly SessionConfigOption[]): AcpSessionSelectConfigOption[] {
  return options.flatMap((option) => {
    if (option.type !== 'select')
      return []
    const mapped = option.options.map((choice): AcpSessionConfigChoice => {
      if ('group' in choice) {
        return {
          group: choice.group,
          name: choice.name,
          options: choice.options.map(value => ({
            value: value.value,
            name: value.name,
            ...value.description == null ? {} : { description: value.description },
          })),
        }
      }
      return {
        value: choice.value,
        name: choice.name,
        ...choice.description == null ? {} : { description: choice.description },
      }
    })
    return [{
      type: 'select',
      id: option.id,
      name: option.name,
      ...option.category == null ? {} : { category: option.category },
      ...option.description == null ? {} : { description: option.description },
      currentValue: option.currentValue,
      options: mapped,
    }]
  })
}

function sessionModes(modes: SessionModeState | undefined): { currentModeId?: string, availableModes: AcpSessionMode[] } {
  if (modes === undefined)
    return { availableModes: [] }
  return {
    currentModeId: modes.currentModeId,
    availableModes: modes.availableModes.map(mode => ({
      id: mode.id,
      name: mode.name,
      ...mode.description == null ? {} : { description: mode.description },
    })),
  }
}

function sessionCommands(commands: readonly AvailableCommand[]): AcpSessionCommand[] {
  return commands.map(command => ({
    name: command.name,
    description: command.description,
    ...command.input?.hint == null ? {} : { inputHint: command.input.hint },
  }))
}

export class AcpAdapter extends LlmAdapter implements AcpSessionControl {
  private readonly agents = new Map<string, { process: AcpAgentProcess, facts: string }>()
  /** Routes disabled by configuration whose live process must outlive the running turn. */
  private readonly retiring = new Set<string>()
  private readonly bindings = new Map<string, Binding>()
  private readonly turns = new Map<AcpAgentProcess, Map<string, ActiveTurn>>()
  private readonly bindingStore: AcpBindingStore
  private readonly coordinator = new SessionCoordinator()
  private readonly retryPolicy: ResolvedRetryPolicy = resolveRetryPolicy(NO_RETRY, `${PLUGIN_ID}: retryPolicy`)
  private disposed = false

  constructor(
    private readonly host: AdapterHost,
    private readonly profiles: () => ReadonlyMap<string, AcpAgentProfile>,
    private readonly contextWindows: ContextWindows = new ContextWindows(),
    private readonly capabilities: PromptCapabilitiesCache = new PromptCapabilitiesCache(),
  ) {
    super()
    this.bindingStore = host.bindingStore ?? new MemoryAcpBindingStore()
  }

  /**
   * Report the control surface of every ACP route bound to one conversation.
   *
   * This is a read: it never starts an agent session. The conversation panel polls it once a
   * second to render config options, so materializing a binding here would spawn a full
   * agent — MCP servers included — for a conversation that may never send a message. A
   * session is started when the conversation actually generates something, which is what
   * `stream` already does.
   *
   * @param dshSessionId - conversation whose ACP bindings to describe.
   * @returns one snapshot per route that holds a binding for this conversation.
   */
  async getSessionSnapshots(dshSessionId: string): Promise<AcpSessionSnapshot[]> {
    const providers = new Set<string>()
    for (const binding of this.bindings.values()) {
      if (binding.dshSessionId === dshSessionId)
        providers.add(binding.provider)
    }
    for (const provider of this.profiles().keys())
      providers.add(provider)
    const snapshots: AcpSessionSnapshot[] = []
    for (const provider of providers) {
      const binding = await this.bindingOf(provider, dshSessionId)
      if (binding === undefined)
        continue
      if (!this.disposed && binding.pending === undefined && binding.session === undefined) {
        const profile = this.profiles().get(provider)
        // Restoring a *recorded* session replays it over the existing agent; starting a
        // fresh one would spawn a whole agent (MCP servers included) for a conversation that
        // may never send anything. Only the former belongs in a read.
        if (profile !== undefined && binding.acpSessionId !== undefined)
          await this.restoreSessionForSnapshot(binding, provider, profile)
      }
      snapshots.push(this.snapshotOf(binding))
    }
    return snapshots
  }

  /**
   * Reattach one recorded ACP session so a snapshot can describe it.
   *
   * @param binding - persisted binding to restore.
   * @param provider - route the binding belongs to.
   * @param profile - resolved profile for that route.
   */
  private async restoreSessionForSnapshot(binding: Binding, provider: string, profile: AcpAgentProfile): Promise<void> {
    const key = this.bindingKey(provider, binding.dshSessionId ?? '')
    await this.coordinator
      .run(key, async () => {
        const latest = await this.bindingOf(provider, binding.dshSessionId ?? '')
        if (latest === undefined || latest.pending !== undefined || latest.session !== undefined)
          return
        if (latest.acpSessionId === undefined)
          return
        const agent = this.agent(provider, profile)
        // Handshake first: an agent that cannot replay a recorded session must not be asked
        // for one, because `ensureSession` answers a failed load with `session/new` — the
        // process this read exists to avoid.
        await agent.probeCapabilities().catch(() => undefined)
        if (!agent.supportsLoadSession)
          return
        await this.ensureSession(latest, agent, profile, latest.model)
        // `ensureSession` falls back to a fresh session when load fails. That fallback is
        // exactly the spawn this read must avoid, so drop the binding back to unbound.
        if (latest.session !== undefined && latest.recovery !== 'loaded') {
          this.agents.get(provider)?.process.closeSession(latest.session)
          latest.session = undefined
          latest.acpSessionId = undefined
        }
      })
      .catch(() => undefined)
  }

  async setSessionConfig(provider: string, sessionId: string, configId: string, value: string, expectedRevision?: number): Promise<AcpSessionSnapshot> {
    const key = this.bindingKey(provider, sessionId)
    const before = await this.bindingOf(provider, sessionId)
    if (before === undefined)
      throw new LlmError(`${PLUGIN_ID}: no ACP session is bound to "${provider}" in this conversation`, 'INVALID_REQUEST')
    if (expectedRevision !== undefined && before.revision !== expectedRevision)
      throw new LlmError(`${PLUGIN_ID}: ACP session settings changed; refresh before applying another value`, 'INVALID_REQUEST')
    const expectedSettingsRevision = before.settingsRevision
    return this.coordinator.run(key, async () => {
      const binding = await this.bindingOf(provider, sessionId)
      if (binding === undefined)
        throw new LlmError(`${PLUGIN_ID}: no ACP session is bound to "${provider}" in this conversation`, 'INVALID_REQUEST')
      this.assertKnown(binding)
      const [agent, session] = await this.controlSession(binding)
      if (expectedRevision !== undefined && binding.settingsRevision !== expectedSettingsRevision)
        throw new LlmError(`${PLUGIN_ID}: ACP session settings changed; refresh before applying another value`, 'INVALID_REQUEST')
      const option = session.configOptions.find(candidate => candidate.id === configId)
      if (option?.type !== 'select' || option.id === 'model' || option.id === 'thought_level' || option.category === 'model' || option.category === 'thought_level')
        throw new LlmError(`${PLUGIN_ID}: configuration "${configId}" is not editable through the ACP session panel`, 'INVALID_REQUEST')
      const available = option.options.flatMap(choice => 'group' in choice ? choice.options : [choice])
      if (!available.some(choice => choice.value === value))
        throw new LlmError(`${PLUGIN_ID}: value "${value}" is not offered for ACP configuration "${configId}"`, 'INVALID_REQUEST')
      await agent.setConfigOption(session, configId, value)
      binding.settingsRevision++
      binding.revision++
      await this.persistBinding(binding)
      return this.snapshotOf(binding)
    })
  }

  async setSessionMode(provider: string, sessionId: string, modeId: string, expectedRevision?: number): Promise<AcpSessionSnapshot> {
    const key = this.bindingKey(provider, sessionId)
    const before = await this.bindingOf(provider, sessionId)
    if (before === undefined)
      throw new LlmError(`${PLUGIN_ID}: no ACP session is bound to "${provider}" in this conversation`, 'INVALID_REQUEST')
    if (expectedRevision !== undefined && before.revision !== expectedRevision)
      throw new LlmError(`${PLUGIN_ID}: ACP session settings changed; refresh before applying another value`, 'INVALID_REQUEST')
    const expectedSettingsRevision = before.settingsRevision
    return this.coordinator.run(key, async () => {
      const binding = await this.bindingOf(provider, sessionId)
      if (binding === undefined)
        throw new LlmError(`${PLUGIN_ID}: no ACP session is bound to "${provider}" in this conversation`, 'INVALID_REQUEST')
      this.assertKnown(binding)
      const [agent, session] = await this.controlSession(binding)
      if (expectedRevision !== undefined && binding.settingsRevision !== expectedSettingsRevision)
        throw new LlmError(`${PLUGIN_ID}: ACP session settings changed; refresh before applying another value`, 'INVALID_REQUEST')
      const available = session.modes?.availableModes ?? []
      if (available.some(mode => mode.id === modeId)) {
        await agent.setMode(session, modeId)
      }
      else {
        const option = session.configOptions.find(candidate => candidate.type === 'select' && candidate.category === 'mode')
        const choices = option?.type === 'select' ? option.options.flatMap(choice => 'group' in choice ? choice.options : [choice]) : []
        if (option?.type !== 'select' || !choices.some(choice => choice.value === modeId))
          throw new LlmError(`${PLUGIN_ID}: mode "${modeId}" is not offered by this ACP session`, 'INVALID_REQUEST')
        await agent.setConfigOption(session, option.id, modeId)
      }
      binding.settingsRevision++
      binding.revision++
      await this.persistBinding(binding)
      return this.snapshotOf(binding)
    })
  }

  async resetSession(provider: string, sessionId: string): Promise<void> {
    const key = this.bindingKey(provider, sessionId)
    await this.coordinator.run(key, async () => {
      const binding = await this.bindingOf(provider, sessionId)
      if (binding === undefined)
        return
      const submitted = [...binding.consumed, ...(binding.pending?.messageIds ?? [])]
      binding.replayBarrierIds = [...new Set([...binding.replayBarrierIds, ...submitted])]
      binding.needsFreshInput = true
      binding.unlisten?.()
      binding.unlisten = undefined
      if (binding.session !== undefined)
        this.agents.get(provider)?.process.closeSession(binding.session)
      binding.session = undefined
      binding.acpSessionId = undefined
      binding.consumed = []
      binding.usage = undefined
      binding.settingsRevision++
      binding.pending = undefined
      binding.turnState = 'idle'
      binding.recovery = 'new'
      binding.model = DEFAULT_MODEL_ID
      binding.revision++
      await this.persistBinding(binding)
    })
  }

  /**
   * Stop a route without cutting off work already in flight: `/model`, the catalog and new turns
   * lose the route immediately (the caller has already dropped it from its registration), but a
   * running turn is allowed to finish before its process is disposed and its bindings invalidated.
   * @param route - the provider route being disabled.
   */
  retireRoute(route: string): void {
    const entry = this.agents.get(route)
    if (entry === undefined) {
      this.retiring.delete(route)
      return
    }
    if (this.hasActiveTurn(entry.process)) {
      this.retiring.add(route)
      return
    }
    this.retiring.delete(route)
    entry.process.dispose()
    this.agents.delete(route)
    this.invalidateBindings(route)
  }

  /** Undo a parked retirement (the route was re-enabled before its turn finished). */
  cancelRetirement(route: string): void {
    this.retiring.delete(route)
  }

  /** Whether any conversation currently has a turn running against this route. */
  hasActiveTurn(process: AcpAgentProcess): boolean {
    return (this.turns.get(process)?.size ?? 0) > 0
  }

  /** Run a parked retirement once the route's last turn has settled. */
  private settleRetirements(): void {
    for (const route of [...this.retiring]) {
      const entry = this.agents.get(route)
      if (entry === undefined) {
        this.retiring.delete(route)
        continue
      }
      if (this.hasActiveTurn(entry.process))
        continue
      this.retiring.delete(route)
      entry.process.dispose()
      this.agents.delete(route)
      this.invalidateBindings(route)
    }
  }

  sync(): void {
    const profiles = this.profiles()
    for (const [route, entry] of this.agents) {
      const profile = profiles.get(route)
      if (profile !== undefined && spawnFacts(profile) === entry.facts) {
        this.retiring.delete(route)
        continue
      }
      // A route dropped from configuration while a turn still runs is retired, not aborted:
      // its process has to survive until that turn settles (see `retireRoute`).
      if (profile === undefined && this.hasActiveTurn(entry.process)) {
        this.retiring.add(route)
        continue
      }
      this.retiring.delete(route)
      this.abortTurns(entry.process)
      entry.process.dispose()
      this.agents.delete(route)
      this.invalidateBindings(route)
    }
  }

  dispose(): void {
    if (this.disposed)
      return
    this.disposed = true
    this.abortTurns()
    for (const entry of this.agents.values())
      entry.process.dispose()
    this.agents.clear()
    this.retiring.clear()
    this.turns.clear()
    for (const binding of this.bindings.values()) {
      binding.unlisten?.()
      binding.unlisten = undefined
      binding.session = undefined
      if (binding.pending !== undefined)
        binding.turnState = 'unknown'
    }
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.profiles().get(provider)?.displayName ?? provider }
  }

  override providerRetryPolicy(): ResolvedRetryPolicy {
    return this.retryPolicy
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const profile = this.profiles().get(provider)
    if (profile === undefined)
      return []
    const fallbackName = `${displayText(profile.displayName) ?? provider} (default)`
    // Modalities are read lazily: discovery may be the handshake that first tells this adapter
    // what the agent accepts, so materializing them before the await would miss the answer.
    const fallback = (): LlmModelInfo[] => cleanModels(provider, [{ id: DEFAULT_MODEL_ID, name: fallbackName }], this.modalities(provider))
    if (profile.models.length > 0) {
      const declared = cleanModels(provider, profile.models, this.modalities(provider))
      return declared.length === 0 ? fallback() : declared
    }
    if (!profile.discoverModels)
      return fallback()
    try {
      // The synthetic default stays first so the picker always offers "use the agent's own
      // default"; dedupe then absorbs a real `default` advertised by the agent (claude-code-acp
      // does exactly that) instead of handing dsh a duplicate and losing the whole catalog.
      const found = await this.advertisedModels(provider)
      return cleanModels(provider, [{ id: DEFAULT_MODEL_ID, name: fallbackName }, ...found], this.modalities(provider))
    }
    catch (error) {
      this.host.logger.warn(`${PLUGIN_ID}: model discovery for ACP agent "${provider}" failed`, error)
      return fallback()
    }
  }

  /**
   * Ask the agent behind one configured route which models it advertises, regardless of
   * the profile's declared `models` and `discoverModels` switch. Settings surfaces use this
   * to offer the agent's own list for adoption.
   */
  async advertisedModels(provider: string, signal?: AbortSignal): Promise<readonly AcpAdvertisedModel[]> {
    const profile = this.profiles().get(provider)
    if (profile === undefined)
      throw new LlmError(`${PLUGIN_ID}: no ACP agent is configured for provider "${provider}"`, 'PROVIDER_NOT_FOUND')
    // Clean at the source so both the catalog and the settings "adopt" list only ever offer
    // entries dsh can validate.
    return cleanAdvertisedModels(await this.agent(provider, profile).discoverModels(profile.cwd ?? homedir(), signal))
  }

  /**
   * Exact-model metadata. Capabilities come from the agent itself: accepted input from the
   * `promptCapabilities` of its ACP handshake (learned here, remembered across restarts),
   * reasoning efforts from its `thought_level` option, and the context window it last
   * reported through `usage_update`, else one a "1m" token in the model's id, name or
   * description implies.
   */
  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const profile = this.profiles().get(provider)
    await this.learnCapabilities(provider, signal)
    if (profile?.discoverModels === true && this.agents.get(provider)?.process.advertisedModels === undefined) {
      await this.advertisedModels(provider, signal).catch((error: unknown) => {
        this.host.logger.warn(`${PLUGIN_ID}: probing ACP agent "${provider}" for model metadata failed`, error)
      })
    }
    const process = this.agents.get(provider)?.process
    const discoveryCwd = profile?.cwd ?? homedir()
    const configured = profile?.models.find(entry => entry.id === model)
    const advertised = process?.advertisedModels?.find(entry => entry.id === model)
    // Every fallback here keeps dsh's exact-model contract: a non-empty name and a positive
    // integer window. Configured metadata comes from user JSON and advertised metadata from
    // an external process, so neither is trusted to already satisfy it.
    const contextWindow = validWindow(configured?.contextWindow)
      ?? validWindow(this.contextWindows.get(provider, model))
      ?? inferContextWindow(model, displayText(configured?.name), displayText(configured?.description), displayText(advertised?.name), displayText(advertised?.description))
      ?? validWindow(profile?.contextWindow)
      ?? DEFAULT_CONTEXT_WINDOW
    let efforts: AcpSessionEfforts | undefined
    if (process !== undefined) {
      if (profile?.discoverModels === true) {
        try {
          efforts = await process.discoverEffortsForModel(model, discoveryCwd, signal)
        }
        catch (error) {
          this.host.logger.warn(`${PLUGIN_ID}: probing ACP agent "${provider}" for reasoning metadata failed`, error)
        }
      }
      else {
        efforts = process.knownEffortsForModel(model, discoveryCwd)
      }
    }
    const reasoning = this.reasoningOf(efforts)
    return {
      provider,
      id: model,
      name: displayText(configured?.name) ?? displayText(advertised?.name) ?? model,
      ...this.modalities(provider),
      context: { contextWindow },
      ...reasoning === undefined ? {} : { reasoning },
    }
  }

  /**
   * The agent's thought levels, cleaned for dsh's reasoning contract: unique non-empty ids,
   * non-empty names, and a default that is actually offered. Unknown levels fall back to the
   * id, and unusable ones are dropped rather than failing the whole model resolution.
   */
  private reasoningOf(efforts: AcpSessionEfforts | undefined): NonNullable<LlmResolvedModelInfo['reasoning']> | undefined {
    if (efforts === undefined)
      return undefined
    const seen = new Set<string>()
    const levels: { id: ReasoningEffortId, name: string, description?: string }[] = []
    for (const level of efforts.available) {
      const id = protocolValue(level.id)
      if (id === undefined || seen.has(id))
        continue
      seen.add(id)
      const description = displayText(level.description)
      levels.push({ id: id as ReasoningEffortId, name: displayText(level.name) ?? id, ...description === undefined ? {} : { description } })
    }
    if (levels.length === 0)
      return undefined
    const initial = protocolValue(efforts.initial)
    return {
      efforts: levels,
      ...initial === undefined || !seen.has(initial) ? {} : { defaultEffort: initial as ReasoningEffortId },
    }
  }

  /**
   * What the route accepts as input. dsh reads an omitted `inputModalities` as "unknown" and
   * sends images through untouched, while an explicit list without `image` is a negative it
   * acts on by replacing every attachment with text before the adapter is even called. So an
   * agent whose handshake nobody has heard yet must stay silent rather than claim text only.
   */
  private modalities(provider: string): { inputModalities?: readonly ModelModality[] } {
    const mode = this.profiles().get(provider)?.imageInput ?? 'auto'
    // Without an attachment store there are no image bytes to send, whatever the agent accepts.
    if (mode === 'off' || this.host.readImage === undefined)
      return { inputModalities: TEXT_ONLY }
    if (mode === 'force')
      return { inputModalities: TEXT_AND_IMAGE }
    const known = this.promptCapabilitiesOf(provider)
    if (known === undefined)
      return {}
    return { inputModalities: known.image ? TEXT_AND_IMAGE : TEXT_ONLY }
  }

  /** The running agent's handshake answer, else the one it gave for these spawn facts before. */
  private promptCapabilitiesOf(provider: string): AcpPromptCapabilities | undefined {
    const live = this.agents.get(provider)?.process.promptCapabilities
    if (live !== undefined)
      return live
    const profile = this.profiles().get(provider)
    return profile === undefined ? undefined : this.capabilities.get(provider, spawnFacts(profile))
  }

  /**
   * Make sure the ACP handshake has happened at least once, since that is where an agent
   * states the content types it accepts. The answer is cached per route, so this starts an
   * agent only the first time dsh asks about a route it has never heard from.
   */
  private async learnCapabilities(provider: string, signal?: AbortSignal): Promise<void> {
    const profile = this.profiles().get(provider)
    if (profile === undefined || (profile.imageInput ?? 'auto') !== 'auto' || this.host.readImage === undefined)
      return
    if (this.promptCapabilitiesOf(provider) !== undefined)
      return
    await this.agent(provider, profile).probeCapabilities(signal).catch((error: unknown) => {
      this.host.logger.warn(`${PLUGIN_ID}: asking ACP agent "${provider}" which content it accepts failed`, error)
    })
  }

  /** Read every image the prompt wants, as base64 request versions; unreadable ones stay text. */
  private async readImages(wanted: PromptImages['wanted'], signal: AbortSignal | undefined): Promise<Map<string, PromptImage>> {
    const read = new Map<string, PromptImage>()
    const readImage = this.host.readImage
    if (readImage === undefined)
      return read
    await Promise.all([...wanted].map(async ([id, ref]) => {
      try {
        const image = await readImage(ref, signal)
        read.set(id, { data: Buffer.from(image.data).toString('base64'), mimeType: image.mediaType, width: image.width, height: image.height })
      }
      catch (error) {
        this.host.logger.warn(`${PLUGIN_ID}: could not read image attachment ${id}; sending its text handle instead`, error)
      }
    }))
    return read
  }

  private bindingKey(provider: string, dshSessionId: string): string {
    return `${provider}\u0000${dshSessionId}`
  }

  private snapshotOf(binding: Binding): AcpSessionSnapshot {
    const session = binding.session
    const modes = sessionModes(session?.modes)
    return {
      provider: binding.provider,
      sessionId: binding.dshSessionId ?? '',
      ...session === undefined
        ? binding.acpSessionId === undefined ? {} : { acpSessionId: binding.acpSessionId }
        : { acpSessionId: session.sessionId },
      turnState: binding.pending !== undefined && binding.turnState !== 'running' ? 'unknown' : binding.turnState,
      revision: binding.revision,
      configOptions: sessionConfigChoices(session?.configOptions ?? []),
      ...modes.currentModeId === undefined ? {} : { currentModeId: modes.currentModeId },
      availableModes: modes.availableModes,
      availableCommands: sessionCommands(session?.availableCommands ?? []),
      recovery: binding.recovery,
    }
  }

  private async bindingOf(provider: string, dshSessionId: string): Promise<Binding | undefined> {
    const key = this.bindingKey(provider, dshSessionId)
    const current = this.bindings.get(key)
    if (current !== undefined)
      return current
    const record = await this.bindingStore.load(provider, dshSessionId)
    if (record === undefined)
      return undefined
    const binding: Binding = {
      provider,
      dshSessionId,
      cwd: record.cwd,
      model: record.model,
      consumed: [...record.consumedIds],
      usage: record.usage,
      settingsRevision: 0,
      acpSessionId: record.acpSessionId,
      protocolVersion: record.protocolVersion,
      spawnFactsHash: record.spawnFactsHash,
      replayBarrierIds: [...record.replayBarrierIds],
      needsFreshInput: record.needsFreshInput,
      ...record.pending === undefined ? {} : { pending: { id: record.pending.id, messageIds: [...record.pending.messageIds] } },
      turnState: record.pending === undefined ? 'idle' : 'unknown',
      revision: record.revision,
      recovery: 'new',
    }
    this.bindings.set(key, binding)
    return binding
  }

  private recordOf(binding: Binding): AcpBindingRecord | undefined {
    const dshSessionId = binding.dshSessionId
    if (dshSessionId === undefined)
      return undefined
    return {
      version: 1,
      provider: binding.provider,
      dshSessionId,
      ...(binding.session?.sessionId ?? binding.acpSessionId) === undefined ? {} : { acpSessionId: binding.session?.sessionId ?? binding.acpSessionId },
      cwd: binding.cwd,
      protocolVersion: binding.session?.protocolVersion ?? binding.protocolVersion,
      spawnFactsHash: binding.spawnFactsHash,
      model: binding.model,
      ...binding.usage === undefined ? {} : { usage: binding.usage },
      consumedIds: [...binding.consumed],
      replayBarrierIds: [...binding.replayBarrierIds],
      needsFreshInput: binding.needsFreshInput,
      revision: binding.revision,
      ...binding.pending === undefined ? {} : { pending: { id: binding.pending.id, messageIds: [...binding.pending.messageIds] } },
    }
  }

  private persistBinding(binding: Binding): Promise<void> {
    const record = this.recordOf(binding)
    if (record === undefined)
      return Promise.resolve()
    const previous = binding.persistQueue ?? Promise.resolve()
    const next = previous.catch(() => {}).then(() => this.bindingStore.save(record))
    binding.persistQueue = next
    return next
  }

  private createBinding(provider: string, dshSessionId: string | undefined, profile: AcpAgentProfile, model: string): Binding {
    return {
      provider,
      dshSessionId,
      cwd: this.cwdOf(dshSessionId, profile),
      model,
      consumed: [],
      usage: undefined,
      settingsRevision: 0,
      protocolVersion: 0,
      spawnFactsHash: createHash('sha256').update(spawnFacts(profile)).digest('hex'),
      replayBarrierIds: [],
      needsFreshInput: false,
      turnState: 'idle',
      revision: 0,
      recovery: 'new',
    }
  }

  private assertKnown(binding: Binding): void {
    const refusal = unknownTurnRefusal(binding.turnState, binding.pending !== undefined)
    if (refusal !== undefined)
      throw new LlmError(`${PLUGIN_ID}: ${refusal}`, 'INVALID_REQUEST')
  }

  private attachSession(agent: AcpAgentProcess, binding: Binding): void {
    binding.unlisten?.()
    const session = binding.session
    if (session === undefined)
      return
    binding.unlisten = agent.listen(session, update => this.onSessionUpdate(binding, update))
  }

  private onSessionUpdate(binding: Binding, update: SessionUpdate): void {
    const session = binding.session
    if (session === undefined)
      return
    let changed = false
    let settingsChanged = false
    if (update.sessionUpdate === 'config_option_update') {
      applyConfigOptions(session, update.configOptions)
      changed = true
      settingsChanged = true
    }
    else if (update.sessionUpdate === 'current_mode_update') {
      session.modes = { currentModeId: update.currentModeId, availableModes: session.modes?.availableModes ?? [] }
      changed = true
      settingsChanged = true
    }
    else if (update.sessionUpdate === 'available_commands_update') {
      session.availableCommands = [...update.availableCommands]
      changed = true
    }
    const turn = binding.activeTurn
    if (update.sessionUpdate === 'usage_update' && update.size > 0 && turn !== undefined)
      this.contextWindows.set(binding.provider, turn.model, update.size)
    if (turn !== undefined) {
      turn.recording?.push(update)
      turn.queue.push(...turn.translator.push(update))
      turn.notify()
    }
    if (changed) {
      binding.revision++
      if (settingsChanged)
        binding.settingsRevision++
      if (binding.pending === undefined)
        void this.persistBinding(binding).catch((error: unknown) => this.host.logger.warn(`${PLUGIN_ID}: could not persist ACP session state`, error))
    }
  }

  /**
   * @param mcpServers - servers to offer when this call has to start a session.
   *   Omitted means the host's installed servers, which is what a real conversation wants.
   *   Ephemeral work passes `[]`: it never runs tools, and every forwarded server becomes
   *   another process the agent spawns for a request that will not use it.
   */
  private async ensureSession(binding: Binding, agent: AcpAgentProcess, profile: AcpAgentProfile, model: string, signal?: AbortSignal, mcpServers?: readonly McpServer[]): Promise<boolean> {
    this.assertKnown(binding)
    const cwd = this.cwdOf(binding.dshSessionId, profile)
    const factsHash = createHash('sha256').update(spawnFacts(profile)).digest('hex')
    let session = binding.session
    const active = session !== undefined && session.generation === agent.generation && binding.cwd === cwd && binding.spawnFactsHash === factsHash
    if (session !== undefined && active) {
      if (binding.model !== model) {
        const supportsSelection = session.models.configId !== undefined || session.models.legacy
        if (model === DEFAULT_MODEL_ID || !supportsSelection) {
          binding.unlisten?.()
          binding.unlisten = undefined
          agent.closeSession(session)
          binding.acpSessionId = undefined
          binding.session = undefined
          session = undefined
        }
        else {
          await agent.selectModel(session, model, signal)
          binding.model = session.models.current ?? model
          binding.settingsRevision++
          binding.revision++
          await this.persistBinding(binding)
          return true
        }
      }
      else {
        return true
      }
    }
    if (session !== undefined) {
      binding.unlisten?.()
      binding.unlisten = undefined
      binding.acpSessionId = session.sessionId
      binding.session = undefined
    }

    const canLoad = binding.acpSessionId !== undefined && binding.cwd === cwd && binding.spawnFactsHash === factsHash
    if (canLoad) {
      const loadingUpdates: SessionUpdate[] = []
      try {
        session = await agent.loadSession(binding.acpSessionId!, cwd, signal, update => loadingUpdates.push(update))
      }
      catch (error) {
        this.host.logger.warn(`${PLUGIN_ID}: could not load ACP session for "${binding.provider}"; starting a new session`, error)
      }
      if (session !== undefined) {
        binding.session = session
        for (const update of loadingUpdates)
          this.onSessionUpdate(binding, update)
        const supportsSelection = session.models.configId !== undefined || session.models.legacy
        const current = session.models.current ?? binding.model
        if (model === DEFAULT_MODEL_ID && current !== DEFAULT_MODEL_ID || model !== current && !supportsSelection) {
          agent.discardInitialSessionUpdates(session.sessionId)
          binding.session = undefined
          session = undefined
        }
        else if (model !== current) {
          try {
            await agent.selectModel(session, model, signal)
          }
          catch (error) {
            agent.discardInitialSessionUpdates(session.sessionId)
            binding.session = undefined
            throw error
          }
        }
        if (session !== undefined) {
          binding.session = session
          binding.acpSessionId = session.sessionId
          binding.cwd = cwd
          binding.model = model
          binding.protocolVersion = session.protocolVersion
          binding.spawnFactsHash = factsHash
          binding.recovery = 'loaded'
          binding.settingsRevision++
          this.attachSession(agent, binding)
          binding.revision++
          await this.persistBinding(binding)
          return true
        }
      }
    }

    const fresh = await agent.newSession(cwd, signal, mcpServers)
    try {
      await agent.selectModel(fresh, model, signal)
    }
    catch (error) {
      agent.closeSession(fresh)
      throw error
    }
    binding.unlisten?.()
    binding.session = fresh
    binding.acpSessionId = fresh.sessionId
    binding.cwd = cwd
    binding.model = model
    binding.consumed = []
    binding.usage = undefined
    binding.protocolVersion = fresh.protocolVersion
    binding.spawnFactsHash = factsHash
    binding.pending = undefined
    binding.turnState = 'idle'
    binding.recovery = 'new'
    binding.settingsRevision++
    binding.revision++
    this.attachSession(agent, binding)
    await this.persistBinding(binding)
    return false
  }

  private async controlSession(binding: Binding): Promise<[AcpAgentProcess, AcpSession]> {
    if (this.disposed)
      throw new LlmError(`${PLUGIN_ID}: ACP adapter was disposed`, 'TRANSPORT')
    const profile = this.profiles().get(binding.provider)
    if (profile === undefined)
      throw new LlmError(`${PLUGIN_ID}: no ACP agent is configured for provider "${binding.provider}"`, 'PROVIDER_NOT_FOUND')
    const agent = this.agent(binding.provider, profile)
    if (binding.session === undefined || binding.session.generation !== agent.generation || binding.cwd !== this.cwdOf(binding.dshSessionId, profile))
      await this.ensureSession(binding, agent, profile, binding.model)
    if (binding.session === undefined)
      throw new LlmError(`${PLUGIN_ID}: ACP session could not be restored`, 'TRANSPORT')
    return [agent, binding.session]
  }

  override async* stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    let finished = false
    try {
      for await (const chunk of this.run(options)) {
        finished ||= chunk.type === 'finish'
        yield chunk
      }
    }
    catch (error) {
      if (finished)
        throw error
      yield { type: 'finish', reason: options.signal?.aborted ? { kind: 'aborted', failure: failure('ABORTED', 'request aborted') } : { kind: 'error', failure: failureOf(error) } }
    }
  }

  private async* run(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const route = options.provider
    const profile = this.profiles().get(route)
    if (profile === undefined)
      throw new LlmError(PLUGIN_ID + ': no ACP agent is configured for provider "' + route + '"', 'PROVIDER_NOT_FOUND')
    const signal = options.signal
    if (signal?.aborted) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: failure('ABORTED', 'request aborted before start') } }
      return
    }
    if (this.disposed)
      throw new LlmError(PLUGIN_ID + ': ACP adapter was disposed', 'TRANSPORT')

    const agent = this.agent(route, profile)
    const purpose = Reflect.get(options, 'purpose') as string | undefined
    const dshSessionId = options.sessionId as string | undefined
    const ephemeral = dshSessionId === undefined || purpose !== undefined
    // Ephemeral work (compaction, session titles) arrives in bursts. Each request opens its
    // own session and never reuses one, so an unserialized burst of N opened N sessions —
    // and each agent session carries its own MCP servers, which is what turned a burst into
    // dozens of processes. They are short, independent jobs, so one at a time per route is
    // enough; the lock key is namespaced so it never contends with a user's real session.
    const key = this.bindingKey(route, dshSessionId ?? '')
    const release = await this.coordinator.acquire(ephemeral ? ephemeralKeyOf(route) : key)
    const system = profile.systemPrompt === 'forward' ? systemText(options) : undefined
    const requestedEffort = options.reasoningEffort as string | undefined
    let binding: Binding | undefined
    let session: AcpSession | undefined
    let active: ActiveTurn | undefined
    let submittedConversation: ReturnType<typeof conversationOf> = []
    let pendingId: string | undefined
    let requestStarted = false
    let idleTimer: NodeJS.Timeout | undefined
    let cancelTimer: NodeJS.Timeout | undefined
    let forwardAbort: (() => void) | undefined
    let onAbort: (() => void) | undefined
    let wake: (() => void) | undefined
    const notify = (): void => {
      wake?.()
      wake = undefined
    }
    // The turn's result is latched the moment it is known; draining may continue past it so
    // late output still reaches the transcript.
    let draining = false
    // Settlement precedence lives in domain/turn.ts; this closure only adds the wake-up.
    const settlement = createTurnSettlement()
    const currentOutcome = (): Outcome | undefined => settlement.current() as Outcome | undefined
    const settle = (next: Outcome): void => {
      settlement.settle(next)
      notify()
    }
    const settlePersistentResponse = async (response: PromptResponse): Promise<void> => {
      const pending = binding?.pending
      if (binding === undefined || pending?.id !== pendingId)
        return
      const previousConsumed = binding.consumed
      const previousUsage = binding.usage
      const previousRevision = binding.revision
      binding.pending = undefined
      binding.consumed = consumedIds(submittedConversation)
      binding.usage = response.usage ?? binding.usage
      binding.turnState = 'idle'
      binding.revision++
      try {
        await this.persistBinding(binding)
      }
      catch (error) {
        binding.pending = pending
        binding.consumed = previousConsumed
        binding.usage = previousUsage
        binding.turnState = 'unknown'
        binding.revision = previousRevision
        throw error
      }
    }

    try {
      if (this.disposed)
        throw new LlmError(PLUGIN_ID + ': ACP adapter was disposed', 'TRANSPORT')
      if (ephemeral) {
        binding = this.createBinding(route, undefined, profile, options.model)
      }
      else {
        binding = await this.bindingOf(route, dshSessionId!)
          ?? this.createBinding(route, dshSessionId, profile, options.model)
        this.bindings.set(key, binding)
        this.assertKnown(binding)
      }

      let reused = await this.ensureSession(binding, agent, profile, options.model, signal, ephemeral ? [] : undefined)
      session = binding.session
      if (session === undefined)
        throw new LlmError(PLUGIN_ID + ': ACP session could not be started', 'TRANSPORT')

      let conversation = conversationOf(options)
      if (binding.needsFreshInput) {
        const freshUserIndex = conversation.findIndex(message => message.role === 'user' && message.id !== undefined && !binding!.replayBarrierIds.includes(message.id))
        if (freshUserIndex < 0)
          throw new LlmError(`${PLUGIN_ID}: send a new user message after resetting this ACP session`, 'INVALID_REQUEST')
        const abandonedIds = consumedIds(conversation.slice(0, freshUserIndex))
        binding.replayBarrierIds = [...new Set([...binding.replayBarrierIds, ...abandonedIds])]
        const barriers = new Set(binding.replayBarrierIds)
        conversation = conversation.slice(freshUserIndex).filter(message => message.id === undefined || !barriers.has(message.id))
      }
      else {
        const barriers = new Set(binding.replayBarrierIds)
        conversation = conversation.filter(message => message.id === undefined || !barriers.has(message.id))
      }
      submittedConversation = conversation
      let images: PromptImages = { read: new Map(), wanted: new Map() }
      let consumedBefore = reused ? [...binding.consumed] : []
      let prompt = reused ? incrementalPrompt(conversation, consumedBefore, route, images) : undefined

      if (reused && prompt === undefined) {
        binding.unlisten?.()
        binding.unlisten = undefined
        agent.closeSession(session)
        binding.session = undefined
        binding.acpSessionId = undefined
        binding.consumed = []
        binding.usage = undefined
        reused = await this.ensureSession(binding, agent, profile, options.model, signal, ephemeral ? [] : undefined)
        session = binding.session
        if (session === undefined)
          throw new LlmError(PLUGIN_ID + ': ACP session could not be restarted', 'TRANSPORT')
        consumedBefore = []
        images = { read: new Map(), wanted: new Map() }
      }

      if (!reused)
        prompt = fullPrompt(conversation, system, images)
      if (prompt === undefined)
        throw new LlmError(PLUGIN_ID + ': ACP prompt could not be constructed', 'INVALID_REQUEST')

      const wantedEffort = requestedEffort ?? session.efforts?.initial
      const previousEffort = session.efforts?.current
      if (wantedEffort !== undefined)
        await agent.selectEffort(session, wantedEffort, signal)
      if (session.efforts?.current !== previousEffort)
        binding.settingsRevision++
      if (images.wanted.size > 0 && agent.supportsImages) {
        images = { read: await this.readImages(images.wanted, signal), wanted: new Map() }
        prompt = reused
          ? incrementalPrompt(conversation, consumedBefore, route, images) ?? prompt
          : fullPrompt(conversation, system, images)
      }
      if (signal?.aborted)
        throw new LlmError('ACP request was aborted before submission', 'ABORTED')

      const recording = ephemeral ? undefined : this.host.startRecording?.(dshSessionId)
      const queue: StreamChunk[] = []
      const translator = new ChunkTranslator(profile.showToolCalls)
      const controller = new AbortController()
      const usageBefore = binding.usage
      active = {
        agent,
        session,
        dshSessionId,
        controller,
        recording,
        queue,
        translator,
        notify,
        model: binding.model,
        usageBefore,
        suppressUsage: binding.recovery === 'loaded' && usageBefore === undefined,
        binding,
        promptSettled: false,
        finished: false,
      }
      binding.activeTurn = active
      if (!ephemeral) {
        const previousRevision = binding.revision
        const previousNeedsFreshInput = binding.needsFreshInput
        const pending: AcpPendingTurn = {
          id: randomUUID(),
          messageIds: reused
            ? conversation.slice(consumedBefore.length).filter(message => message.role === 'user' && message.id !== undefined).map(message => message.id!)
            : consumedIds(conversation),
        }
        pendingId = pending.id
        binding.pending = pending
        binding.needsFreshInput = false
        binding.turnState = 'running'
        binding.revision++
        try {
          await this.persistBinding(binding)
        }
        catch (error) {
          binding.pending = undefined
          binding.needsFreshInput = previousNeedsFreshInput
          binding.turnState = 'idle'
          binding.revision = previousRevision
          pendingId = undefined
          throw error
        }
        if (signal?.aborted) {
          const pendingRevision = binding.revision
          binding.pending = undefined
          binding.needsFreshInput = previousNeedsFreshInput
          binding.turnState = 'idle'
          binding.revision++
          try {
            await this.persistBinding(binding)
          }
          catch (error) {
            binding.pending = pending
            binding.needsFreshInput = false
            binding.turnState = 'unknown'
            binding.revision = pendingRevision
            this.host.logger.warn(`${PLUGIN_ID}: could not clear an unsubmitted ACP turn`, error)
          }
          pendingId = undefined
          throw new LlmError('ACP request was aborted before submission', 'ABORTED')
        }
      }
      else {
        binding.turnState = 'running'
      }

      this.registerTurn(agent, active)
      const armIdle = (): void => {
        if (profile.idleTimeoutMs <= 0)
          return
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          // Latch the timeout before aborting the controller, so the onAbort it triggers sees
          // an authoritative reason and does not relabel it as a user cancellation.
          settle({ kind: 'timeout' })
          controller.abort()
          agent.cancel(session!)
        }, profile.idleTimeoutMs)
      }
      onAbort = (): void => {
        agent.cancel(session!)
        // Latch the abort now: the grace window only decides when to stop draining, and must
        // not leave the turn's result open for a racing response to claim. A timeout latched
        // before this point stays authoritative — it explains why the turn ended.
        if (currentOutcome()?.kind !== 'timeout')
          settle({ kind: 'aborted' })
        cancelTimer = setTimeout(() => {
          draining = true
          notify()
        }, CANCEL_GRACE_MS)
      }
      active.notify = () => {
        armIdle()
        notify()
      }
      forwardAbort = (): void => {
        if (!controller.signal.aborted)
          controller.abort()
      }
      signal?.addEventListener('abort', forwardAbort, { once: true })
      controller.signal.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted)
        controller.abort()
      armIdle()

      requestStarted = true
      void agent.prompt(session, prompt).then(async (response) => {
        active!.promptSettled = true
        if (!ephemeral) {
          if (active!.finished) {
            try {
              await this.coordinator.run(key, () => settlePersistentResponse(response))
            }
            catch (error) {
              this.host.logger.warn(`${PLUGIN_ID}: could not settle a late ACP response`, error)
            }
          }
          else {
            active!.settlement = settlePersistentResponse(response)
            try {
              await active!.settlement
            }
            catch (error) {
              settle({ kind: 'error', error })
              return
            }
          }
        }
        else if (!active!.finished) {
          binding!.usage = response.usage ?? binding!.usage
        }
        settle({ kind: 'response', response })
      }, (error: unknown) => {
        active!.promptSettled = true
        if (!ephemeral && binding!.pending?.id === pendingId)
          binding!.turnState = 'unknown'
        settle({ kind: 'error', error })
      })

      while (true) {
        while (queue.length > 0)
          yield queue.shift()!
        // A latched abort keeps draining until its grace window closes; every other outcome
        // ends the turn as soon as it settles.
        const settled = currentOutcome()
        if (settled !== undefined && (settled.kind !== 'aborted' || draining))
          break
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
      yield* translator.close()
      yield* this.finish(currentOutcome()!, translator, binding!, ephemeral, signal, usageBefore, active!.suppressUsage)
    }
    finally {
      clearTimeout(idleTimer)
      clearTimeout(cancelTimer)
      if (signal !== undefined && forwardAbort !== undefined)
        signal.removeEventListener('abort', forwardAbort)
      if (active !== undefined) {
        active.finished = true
        await active.settlement?.catch(() => {})
        if (onAbort !== undefined)
          active.controller.signal.removeEventListener('abort', onAbort)
        this.unregisterTurn(agent, active)
        if (binding?.activeTurn === active)
          binding.activeTurn = undefined
        if (binding !== undefined) {
          if (binding.pending !== undefined)
            binding.turnState = 'unknown'
          else if (binding.turnState === 'running')
            binding.turnState = 'idle'
        }
        if (currentOutcome() === undefined && requestStarted) {
          active.controller.abort()
          agent.cancel(active.session)
        }
      }
      if (ephemeral && session !== undefined)
        agent.closeSession(session)
      release()
    }
  }

  private* finish(outcome: Outcome, translator: ChunkTranslator, binding: Binding, ephemeral: boolean, signal: AbortSignal | undefined, usageBefore: Usage | undefined, suppressUsage: boolean): Iterable<StreamChunk> {
    if (outcome.kind === 'error') {
      if (signal?.aborted) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: failure('ABORTED', 'request aborted') } }
        return
      }
      throw outcome.error
    }
    if (outcome.kind === 'timeout') {
      yield { type: 'finish', reason: { kind: 'error', failure: failure('TIMEOUT', `ACP agent was idle for longer than the configured idleTimeoutMs`) } }
      return
    }
    if (outcome.kind === 'aborted') {
      yield { type: 'finish', reason: { kind: 'aborted', failure: failure('ABORTED', 'request aborted') } }
      return
    }
    const { response } = outcome
    if (response.usage != null && !suppressUsage) {
      yield { type: 'usage', usage: usageDelta(response.usage, ephemeral ? undefined : usageBefore) }
    }
    switch (response.stopReason) {
      case 'end_turn':
        yield translator.emittedBlocks === 0
          ? { type: 'finish', reason: { kind: 'error', failure: failure('EMPTY_RESPONSE', 'ACP agent ended the turn without any content') } }
          : { type: 'finish', reason: { kind: 'stop' } }
        return
      case 'max_tokens':
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
        return
      case 'cancelled':
        yield { type: 'finish', reason: { kind: 'aborted', failure: failure('ABORTED', 'ACP agent cancelled the turn') } }
        return
      case 'refusal':
        yield { type: 'finish', reason: { kind: 'error', failure: failure('REFUSAL', 'ACP agent refused the request') } }
        return
      default:
        yield { type: 'finish', reason: { kind: 'error', failure: failure('MAX_TURN_REQUESTS', `ACP agent stopped: ${response.stopReason}`) } }
    }
  }

  private agent(route: string, profile: AcpAgentProfile): AcpAgentProcess {
    if (this.disposed)
      throw new LlmError(`${PLUGIN_ID}: ACP adapter was disposed`, 'TRANSPORT')
    const existing = this.agents.get(route)
    if (existing !== undefined)
      return existing.process
    let process: AcpAgentProcess
    process = new AcpAgentProcess({
      route,
      profile: () => this.profiles().get(route) ?? profile,
      logger: this.host.logger,
      // Remember the handshake answer against the facts that produced it: a route repointed
      // at another command answers for another agent.
      onCapabilities: capabilities => this.capabilities.set(route, this.agents.get(route)?.facts ?? spawnFacts(profile), capabilities),
      onPermission: async (generation, sessionId, request) => {
        const turn = this.turnFor(process, generation, sessionId)
        const finish = turn?.recording?.permission?.(request)
        if (turn === undefined || turn.controller.signal.aborted || turn.promptSettled) {
          finish?.('cancelled')
          return { outcome: { outcome: 'cancelled' } }
        }
        try {
          const response = await decidePermission(
            this.host,
            route,
            (this.profiles().get(route) ?? profile).permission,
            turn === undefined ? undefined : { dshSessionId: turn.dshSessionId, signal: turn.controller.signal },
            request,
          )
          finish?.(permissionOutcome(request, response))
          return response
        }
        catch (error) {
          finish?.('cancelled')
          throw error
        }
      },
    })
    this.agents.set(route, { process, facts: spawnFacts(profile) })
    return process
  }

  private registerTurn(agent: AcpAgentProcess, turn: ActiveTurn): void {
    let sessions = this.turns.get(agent)
    if (sessions === undefined) {
      sessions = new Map()
      this.turns.set(agent, sessions)
    }
    sessions.set(turn.session.sessionId, turn)
  }

  private turnFor(agent: AcpAgentProcess, generation: number, sessionId: string): ActiveTurn | undefined {
    const turn = this.turns.get(agent)?.get(sessionId)
    return turn?.session.generation === generation ? turn : undefined
  }

  private unregisterTurn(agent: AcpAgentProcess, turn: ActiveTurn): void {
    const sessions = this.turns.get(agent)
    if (sessions?.get(turn.session.sessionId) !== turn)
      return
    sessions.delete(turn.session.sessionId)
    if (sessions.size === 0) {
      this.turns.delete(agent)
      this.settleRetirements()
    }
  }

  private abortTurns(agent?: AcpAgentProcess): void {
    for (const [owner, sessions] of this.turns) {
      if (agent !== undefined && owner !== agent)
        continue
      for (const turn of sessions.values()) {
        turn.controller.abort()
        turn.agent.cancel(turn.session)
      }
    }
  }

  private cwdOf(dshSessionId: string | undefined, profile: AcpAgentProfile): string {
    const sessionCwd = dshSessionId === undefined ? undefined : this.host.agentOf(dshSessionId)?.session.header.cwd
    return sessionCwd ?? profile.cwd ?? homedir()
  }

  private invalidateBindings(route: string): void {
    for (const binding of this.bindings.values()) {
      if (binding.provider !== route)
        continue
      binding.activeTurn?.controller.abort()
      if (binding.activeTurn !== undefined)
        binding.activeTurn.agent.cancel(binding.activeTurn.session)
      binding.unlisten?.()
      binding.unlisten = undefined
      binding.session = undefined
      if (binding.pending !== undefined)
        binding.turnState = 'unknown'
    }
  }
}
