import type { McpServer } from '@agentclientprotocol/sdk'
import type { Context } from '@deepseek-ai/cordis'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type z from '@deepseek-ai/schemastery'
import type { AcpAgentProfile } from '../shared/types.ts'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { AdapterHost, AcpRecordSink, ApprovalOutcome, ApprovalRequest, HostAgent, HostImage } from './types/index.ts'
import type { McpLoader } from './service/mcp-servers.ts'
import type { RequestImageBudget, RequestImageTarget } from './service/request-image.ts'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { PLUGIN_ID, SETTINGS_NS } from '../shared/constants.ts'
import { agentsOf, Config } from './config/schema.ts'
import { AcpAdapter } from './service/acp-adapter.ts'
import { createAcpRecordSink } from './service/acp-record-sink.ts'
import { registerAcpSessionControlBridge } from './dsh-session-control.ts'
import { ContextWindows } from './service/context-windows.ts'
import { collectAcpMcpServers, installMcpServerSource } from './service/mcp-servers.ts'
import { PromptCapabilitiesCache } from './service/prompt-capabilities.ts'
import { requestImageTarget } from './service/request-image.ts'
import { FileAcpBindingStore } from './service/session-store.ts'

/**
 * 0.1 cores offer `installSection` (namespace `llm-acp-pro`, live source swaps); 0.2 cores
 * (`SettingsForms`) key forms by profile entry id, deliver edits as a Loader config
 * update, and take a page policy through `configure`.
 */
interface SettingsService {
  installSection?: <S, T>(owner: Context, ns: string, schema: z<S, T>, entry: T, hooks: {
    setSource: (current: () => T) => void
    onChange: () => void
    validate?: (value: T) => void
  }) => void
  configure?: (presentation: { auto?: boolean }, owner?: unknown) => () => void
}

interface AgentsService {
  get: (sessionId: string) => HostAgent | undefined
}

interface SessionsService {
  get: (id: SessionId) => Session | undefined
}

interface ApprovalService {
  request: (request: ApprovalRequest) => Promise<ApprovalOutcome>
}

interface AttachmentsService {
  /** `target` is the exact size to produce, not a budget: see {@link requestImageTarget}. */
  readImageRequest: (ref: unknown, target: RequestImageTarget, signal?: AbortSignal) => Promise<HostImage>
}

/** Where this plugin's learned facts persist: `$DSH_HOME` (default `~/.dsh`), as dsh resolves it. */
function dshHomeDirectory(): string {
  const configured = process.env.DSH_HOME?.trim()
  const home = configured === undefined || configured.length === 0
    ? join(homedir(), '.dsh')
    : configured === '~' || configured.startsWith('~/') ? join(homedir(), configured.slice(1)) : configured
  return resolve(home)
}

function cacheFile(name: string): string {
  return join(dshHomeDirectory(), 'cache', PLUGIN_ID, name)
}

function sessionDataDirectory(ctx: Context): string {
  const profileDir = (ctx.get('profileContext') as { dir?: unknown } | undefined)?.dir
  if (typeof profileDir === 'string' && isAbsolute(profileDir))
    return join(profileDir, 'data', PLUGIN_ID)
  return join(dshHomeDirectory(), 'data', PLUGIN_ID)
}

/** Same request-image budget dsh-llm-pi-ai uses by default. */
const IMAGE_BUDGET: RequestImageBudget = { maxPixels: 4_194_304, maxBytes: 1_048_576 }

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 0.2 Loader: volatile config fields of this fiber were committed in place. */
    'loader/volatile-update': (paths: string[][]) => void
  }
}

function assertProfiles(config: Config): void {
  for (const [route, profile] of Object.entries(agentsOf(config))) {
    if (route.trim().length === 0)
      throw new Error(`${PLUGIN_ID}: agent route names must be non-empty`)
    if (profile.command.trim().length === 0)
      throw new Error(`${PLUGIN_ID}: agent "${route}" needs a command`)
  }
}

/** The namespace configuration surfaces edit this plugin's profiles under. */
function settingsNsOf(ctx: Context): string {
  const settings = ctx.get('settings') as SettingsService | undefined
  if (typeof settings?.installSection === 'function')
    return SETTINGS_NS
  const entryId = (ctx.fiber as unknown as { entry?: { options?: { id?: unknown } } }).entry?.options?.id
  return typeof entryId === 'string' ? entryId : PLUGIN_ID
}

/** Routes the host should register: everything the user did not disable. */
function enabledRoutes(profiles: ReadonlyMap<string, AcpAgentProfile>): string[] {
  return [...profiles.entries()].filter(([, profile]) => profile.enabled !== false).map(([route]) => route)
}

function directoryEntries(profiles: ReadonlyMap<string, AcpAgentProfile>, settingsNs: string): LlmConfigurableProvider[] {
  return enabledRoutes(profiles).map(provider => {
    const profile = profiles.get(provider)!
    return ({
    provider,
    displayName: profile.displayName ?? provider,
    settingsNs,
      settingsPath: ['agents', provider],
      declared: true,
    })
  })
}

/** Registration-relevant facts: enabled routes and their display names. Favorites never appear. */
function routeFacts(profiles: ReadonlyMap<string, AcpAgentProfile>, settingsNs: string): string {
  return JSON.stringify([settingsNs, enabledRoutes(profiles).map(route => [route, profiles.get(route)?.displayName ?? null]).sort()])
}

export function apply(ctx: Context, config: Config): void {
  assertProfiles(config)
  let current: () => Config = () => config
  let lastAgents: unknown
  let memo: ReadonlyMap<string, AcpAgentProfile> = new Map()
  const profiles = (): ReadonlyMap<string, AcpAgentProfile> => {
    const agents = agentsOf(current())
    if (agents !== lastAgents) {
      memo = new Map(Object.entries(agents))
      lastAgents = agents
    }
    return memo
  }

  const host: AdapterHost = {
    logger: ctx.logger,
    bindingStore: new FileAcpBindingStore(sessionDataDirectory(ctx)),
    agentOf: sessionId => (ctx.get('agents') as AgentsService | undefined)?.get(sessionId),
    get approve() {
      const approval = ctx.get('approval') as ApprovalService | undefined
      return approval === undefined ? undefined : (request: ApprovalRequest) => approval.request(request)
    },
    get readImage() {
      const attachments = ctx.get('attachments') as AttachmentsService | undefined
      return typeof attachments?.readImageRequest !== 'function'
        ? undefined
        : (ref: unknown, signal?: AbortSignal) => attachments.readImageRequest(ref, requestImageTarget(ref, IMAGE_BUDGET), signal)
    },
    startRecording(dshSessionId): AcpRecordSink | undefined {
      if (dshSessionId === undefined)
        return undefined
      const sessions = ctx.get('sessions') as SessionsService | undefined
      const session = sessions?.get(dshSessionId as SessionId)
      return createAcpRecordSink(session, ctx.logger)
    },
  }
  const adapter = new AcpAdapter(
    host,
    profiles,
    new ContextWindows(cacheFile('context-windows.json'), ctx.logger),
    new PromptCapabilitiesCache(cacheFile('prompt-capabilities.json'), ctx.logger),
  )
  ctx.effect(() => () => adapter.dispose(), `${PLUGIN_ID}: agents`)
  ctx.effect(async () => {
    try {
      const dispose = await registerAcpSessionControlBridge(ctx, adapter)
      if (dispose !== undefined)
        return dispose
      ctx.logger.warn(`${PLUGIN_ID}: ACP session controls are unavailable because the Typert Host API is missing`)
    }
    catch (error) {
      ctx.logger.warn(`${PLUGIN_ID}: ACP session controls are unavailable`, error)
    }
    return () => {}
  }, `${PLUGIN_ID}: session control bridge`)

  // `dsh-mcp-client` runs one entry per server and publishes no registry, so the Loader entry
  // tree is the enumerable source. Profile patches insert those entries after this bundle's,
  // so resolution stays lazy and the result is reused until another plugin mounts or unloads.
  let mcpServers: readonly McpServer[] | undefined
  const forwardedMcpServers = (): readonly McpServer[] => mcpServers ??= collectAcpMcpServers(ctx.get('loader') as McpLoader | undefined, ctx.logger)
  installMcpServerSource(forwardedMcpServers)
  ctx.on('internal/plugin', () => {
    mcpServers = undefined
  }, { global: true })
  ctx.effect(() => () => installMcpServerSource(undefined), `${PLUGIN_ID}: mcp servers`)

  // Discovery serves the settings editor's "discover models" action. An ACP draft is a
  // command line, which the discovery request cannot carry, so only saved routes answer.
  ctx.llm.registerModelDiscovery(SETTINGS_NS, async (request, signal) => {
    const route = request.provider ?? ''
    if (!profiles().has(route))
      throw new Error(`${PLUGIN_ID}: save ACP agent "${route}" before discovering its models`)
    const found = await adapter.advertisedModels(route, signal)
    return found.map(model => ({ id: model.id, name: model.name }))
  })

  let registration: AdapterRegistrationHandle | undefined
  let directory: DirectoryRegistrationHandle | undefined
  let registeredFacts: string | undefined
  const reconcile = (): void => {
    adapter.sync()
    const snapshot = profiles()
    // Disabled routes leave the registry and the directory, but a turn already running keeps its
    // process until it settles (see AcpAdapter.retireRoute). Re-enabled routes cancel that parking.
    const enabled = new Set(enabledRoutes(snapshot))
    for (const route of snapshot.keys()) {
      if (enabled.has(route))
        adapter.cancelRetirement(route)
      else
        adapter.retireRoute(route)
    }
    const settingsNs = settingsNsOf(ctx)
    const facts = routeFacts(snapshot, settingsNs)
    if (facts === registeredFacts)
      return
    const routes = enabledRoutes(snapshot)
    if (registration === undefined) {
      if (routes.length > 0)
        registration = ctx.llm.registerAdapter(routes, adapter)
    }
    else {
      registration.replace(routes)
    }
    const entries = directoryEntries(snapshot, settingsNs)
    if (directory === undefined) {
      if (entries.length > 0)
        directory = ctx.llm.registerConfigurableProviders(entries)
    }
    else {
      directory.replace(entries)
    }
    registeredFacts = facts
  }
  const safeReconcile = (): void => {
    try {
      reconcile()
    }
    catch (error) {
      ctx.logger.error(`${PLUGIN_ID}: keeping the previously registered ACP routes after a refused update`, error)
    }
  }
  reconcile()
  // 0.2 cores commit settings edits into the `agents` cell without restarting the plugin.
  ctx.on('loader/volatile-update', safeReconcile)

  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.get('settings') as SettingsService
    if (typeof settings.installSection !== 'function') {
      // The client settings page replaces the generated form for this entry.
      if (typeof settings.configure === 'function')
        settingsCtx.effect(() => settings.configure!({ auto: false }, ctx.fiber))
      safeReconcile()
      return
    }
    settings.installSection(ctx, SETTINGS_NS, Config, config, {
      validate: assertProfiles,
      setSource: (source) => {
        current = source
      },
      onChange: safeReconcile,
    })
  })
}
