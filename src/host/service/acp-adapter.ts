import type { ContentBlock as AcpContentBlock, PromptResponse, Usage } from '@agentclientprotocol/sdk'
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
import type { AcpRecordSink, AdapterHost } from '../types/index.ts'
import type { AcpAdvertisedModel, AcpSession, AcpSessionEfforts } from './acp-agent.ts'
import type { AcpPromptCapabilities } from './prompt-capabilities.ts'
import type { PromptImage, PromptImages } from './transcript.ts'
import type { PermissionTurn } from './permission.ts'
import { homedir } from 'node:os'
import { LlmAdapter, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PLUGIN_ID } from '../../shared/constants.ts'
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MODEL_ID } from '../config/constants.ts'
import { AcpAgentProcess, applyConfigOptions } from './acp-agent.ts'
import { ChunkTranslator, usageDelta } from './chunk-translator.ts'
import { ContextWindows, inferContextWindow } from './context-windows.ts'
import { decidePermission, permissionOutcome } from './permission.ts'
import { PromptCapabilitiesCache } from './prompt-capabilities.ts'
import { consumedIds, conversationOf, fullPrompt, incrementalPrompt, systemText } from './transcript.ts'

interface Binding {
  session: AcpSession
  cwd: string
  model: string
  consumed: string[]
  usage: Usage | undefined
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

export class AcpAdapter extends LlmAdapter {
  private readonly agents = new Map<string, { process: AcpAgentProcess, facts: string }>()
  private readonly bindings = new Map<string, Binding>()
  private readonly turns = new Map<string, PermissionTurn>()
  private readonly recordings = new Map<string, AcpRecordSink>()
  private readonly retryPolicy: ResolvedRetryPolicy = resolveRetryPolicy(NO_RETRY, `${PLUGIN_ID}: retryPolicy`)

  constructor(
    private readonly host: AdapterHost,
    private readonly profiles: () => ReadonlyMap<string, AcpAgentProfile>,
    private readonly contextWindows: ContextWindows = new ContextWindows(),
    private readonly capabilities: PromptCapabilitiesCache = new PromptCapabilitiesCache(),
  ) {
    super()
  }

  sync(): void {
    const profiles = this.profiles()
    for (const [route, entry] of this.agents) {
      const profile = profiles.get(route)
      if (profile !== undefined && spawnFacts(profile) === entry.facts)
        continue
      entry.process.dispose()
      this.agents.delete(route)
      this.dropBindings(route)
    }
  }

  dispose(): void {
    for (const entry of this.agents.values())
      entry.process.dispose()
    this.agents.clear()
    this.bindings.clear()
    this.turns.clear()
    this.recordings.clear()
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
    const reasoning = this.reasoningOf(process?.advertisedEfforts)
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
      throw new LlmError(`${PLUGIN_ID}: no ACP agent is configured for provider "${route}"`, 'PROVIDER_NOT_FOUND')
    const signal = options.signal
    if (signal?.aborted) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: failure('ABORTED', 'request aborted before start') } }
      return
    }
    const agent = this.agent(route, profile)
    const purpose = Reflect.get(options, 'purpose') as string | undefined
    const dshSessionId = options.sessionId as string | undefined
    const ephemeral = dshSessionId === undefined || purpose !== undefined
    const recording = ephemeral ? undefined : this.host.startRecording?.(dshSessionId)
    const key = `${route}\u0000${dshSessionId ?? ''}`
    const cwd = this.cwdOf(dshSessionId, profile)
    const conversation = conversationOf(options)
    const system = profile.systemPrompt === 'forward' ? systemText(options) : undefined

    const effort = options.reasoningEffort as string | undefined
    let images: PromptImages = { read: new Map(), wanted: new Map() }
    let binding = ephemeral ? undefined : this.bindings.get(key)
    let reused = binding !== undefined && binding.session.generation === agent.generation && binding.cwd === cwd && binding.model === options.model
    const consumedBefore = reused ? binding!.consumed : []
    let prompt = reused ? incrementalPrompt(conversation, consumedBefore, route, images) : undefined
    if (prompt === undefined || binding === undefined) {
      reused = false
      if (binding !== undefined)
        agent.closeSession(binding.session)
      const session = await agent.newSession(cwd, signal)
      await agent.selectModel(session, options.model, signal)
      binding = { session, cwd, model: options.model, consumed: [], usage: undefined }
      images = { read: new Map(), wanted: new Map() }
      prompt = fullPrompt(conversation, system, images)
    }
    const wantedEffort = effort ?? binding.session.efforts?.initial
    if (wantedEffort !== undefined)
      await agent.selectEffort(binding.session, wantedEffort, signal)
    if (images.wanted.size > 0 && agent.supportsImages) {
      images = { read: await this.readImages(images.wanted, signal), wanted: new Map() }
      prompt = reused ? incrementalPrompt(conversation, consumedBefore, route, images) ?? prompt : fullPrompt(conversation, system, images)
    }
    if (!ephemeral)
      this.bindings.set(key, binding)
    binding.consumed = consumedIds(conversation)

    const session = binding.session
    if (recording !== undefined)
      this.recordings.set(session.sessionId, recording)
    const translator = new ChunkTranslator(profile.showToolCalls)
    const queue: StreamChunk[] = []
    let outcome: Outcome | undefined
    let wake: (() => void) | undefined
    const notify = (): void => {
      wake?.()
      wake = undefined
    }
    const settle = (next: Outcome): void => {
      outcome ??= next
      notify()
    }

    let idleTimer: NodeJS.Timeout | undefined
    const armIdle = (): void => {
      if (profile.idleTimeoutMs <= 0)
        return
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        agent.cancel(session)
        settle({ kind: 'timeout' })
      }, profile.idleTimeoutMs)
    }
    let cancelTimer: NodeJS.Timeout | undefined
    const onAbort = (): void => {
      agent.cancel(session)
      cancelTimer = setTimeout(() => settle({ kind: 'aborted' }), CANCEL_GRACE_MS)
    }

    this.turns.set(session.sessionId, { dshSessionId, signal })
    signal?.addEventListener('abort', onAbort, { once: true })
    armIdle()
    const model = binding.model
    agent.prompt(session, prompt, (update) => {
      armIdle()
      if (update.sessionUpdate === 'usage_update' && update.size > 0)
        this.contextWindows.set(route, model, update.size)
      else if (update.sessionUpdate === 'config_option_update')
        applyConfigOptions(session, update.configOptions)
      recording?.push(update)
      queue.push(...translator.push(update))
      notify()
    }).then(
      response => settle({ kind: 'response', response }),
      error => settle({ kind: 'error', error }),
    )

    try {
      while (true) {
        while (queue.length > 0)
          yield queue.shift()!
        if (outcome !== undefined)
          break
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
      yield* translator.close()
      yield* this.finish(outcome, translator, binding, ephemeral, signal)
    }
    finally {
      clearTimeout(idleTimer)
      clearTimeout(cancelTimer)
      signal?.removeEventListener('abort', onAbort)
      this.turns.delete(session.sessionId)
      this.recordings.delete(session.sessionId)
      if (outcome === undefined)
        agent.cancel(session)
      if (ephemeral)
        agent.closeSession(session)
    }
  }

  private* finish(outcome: Outcome, translator: ChunkTranslator, binding: Binding, ephemeral: boolean, signal: AbortSignal | undefined): Iterable<StreamChunk> {
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
    if (response.usage != null) {
      yield { type: 'usage', usage: usageDelta(response.usage, ephemeral ? undefined : binding.usage) }
      binding.usage = response.usage
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
    const existing = this.agents.get(route)
    if (existing !== undefined)
      return existing.process
    const process = new AcpAgentProcess({
      route,
      profile: () => this.profiles().get(route) ?? profile,
      logger: this.host.logger,
      // Remember the handshake answer against the facts that produced it: a route repointed
      // at another command answers for another agent.
      onCapabilities: capabilities => this.capabilities.set(route, this.agents.get(route)?.facts ?? spawnFacts(profile), capabilities),
      onPermission: async (sessionId, request) => {
        const finish = this.recordings.get(sessionId)?.permission?.(request)
        try {
          const response = await decidePermission(
            this.host,
            route,
            (this.profiles().get(route) ?? profile).permission,
            this.turns.get(sessionId),
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

  private cwdOf(dshSessionId: string | undefined, profile: AcpAgentProfile): string {
    const sessionCwd = dshSessionId === undefined ? undefined : this.host.agentOf(dshSessionId)?.session.header.cwd
    return sessionCwd ?? profile.cwd ?? homedir()
  }

  private dropBindings(route: string): void {
    for (const key of this.bindings.keys()) {
      if (key.startsWith(`${route}\u0000`))
        this.bindings.delete(key)
    }
  }
}
