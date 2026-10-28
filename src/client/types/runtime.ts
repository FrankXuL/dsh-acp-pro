/**
 * Narrow projections of the official client services this plugin uses on DSH 0.2 cores
 * (`configForms` from dsh-client-ui-settings, `locale`, `slots`, `remote.llm`, and the
 * Typert `$mount` session-control namespace). Only the members called here are declared.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ComponentType, ReactElement } from 'react'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AcpSessionControlClient, AcpSessionControlContribution } from '../../shared/session-control-remote.ts'

export type { AcpModelFavorite } from '../../shared/types.ts'

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type SettingsPathOpView
  = | { op: 'set', path: string[], value: JsonValue }
    | { op: 'unset', path: string[] }

/** Client-side state of one settings namespace (`ConfigFormSnapshot`). */
export interface ConfigFormSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  /** Schema-resolved section. */
  value: JsonValue | undefined
  /** Composition layer (profile bundle / YAML) the value resolves over. */
  base: unknown
  /** Raw user layer; presence of a field marks it overridden. */
  user: unknown
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory'
}

/** One namespace's values and serialized writes (`ConfigForm`). */
export interface ConfigForm {
  getSnapshot: () => ConfigFormSnapshot
  subscribe: (listener: () => void) => () => void
  /** Resolves true when the Host accepted the ops; a refused write reloads Host state and resolves false. */
  mutate: (ops: readonly SettingsPathOpView[], expectedRevision?: number) => Promise<boolean>
}

export interface ConfigFormsService {
  get: (entryId: string) => ConfigForm
  whileServed: (namespaces: readonly string[], register: () => () => void) => () => void
}

export interface LocaleService {
  register: (namespace: string, dicts: { zh: Record<string, string>, en: Record<string, string> }) => () => void
  bind: (namespace: string) => (key: string) => string
}

export interface SettingsSectionEntry<P> {
  name: 'settings.section'
  id: string
  order: number
  locale: string
  label: () => string
  inject: () => P
}

/** One slot contribution; the settings section is a special case of this shape. */
export interface SlotEntry {
  name: string
  id?: string
  key?: string
  order?: number
  locale: string
  label?: () => string
  /** Lower values render first; the native seat registers at 0 (engine-level shadowing). */
  priority?: number
  inject?: (arg?: any) => unknown
}

export interface SlotsService {
  inject: (name: string, register: () => unknown) => () => void
  register: (entry: SlotEntry, component: ComponentType<any>) => () => void
}

/** The conversation registry the shell exposes as `uiConversation`. */
export interface UiConversationService {
  events: {
    register: (definition: ConversationNodeDefinition<any>) => () => void
  }
}

/** A renderer for one keyed Chat node; kept loose because keys are merge-extensible. */
export type ChatNodeComponent = (props: any) => ReactElement

export interface RemoteFailure {
  code: string
  message: string
}

export type RemoteResult<T>
  = | { ok: true, value: T }
    | { ok: false, error: RemoteFailure }

export interface LlmDiscoveredModel {
  id: string
  name?: string
  contextWindow?: number
}

export interface LlmRemote {
  discoverModels: (settingsNs: string, request: { provider?: string }) => Promise<RemoteResult<LlmDiscoveredModel[]>>
}

/** The slice of the internal `modelDirectories` service the shadow picker reads. */
export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ModelReasoningEffort {
  id: string
  name: string
  description?: string
}

export interface ModelReasoning {
  efforts: readonly ModelReasoningEffort[]
  defaultEffort?: string
}

export interface ModelInfo {
  id: string
  name: string
  description?: string
  reasoning?: ModelReasoning
}

export interface ModelProviderGroup {
  id: string
  name: string
  models: readonly ModelInfo[]
}

export interface ModelCatalogFailure {
  id: string
  name: string
  message: string
}

export interface ModelDirectoryState {
  current: ModelSelection | null
  retainedEffort?: string
  routable: boolean | null
  groups: readonly ModelProviderGroup[]
  failures: readonly ModelCatalogFailure[]
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  pending: ModelSelection | null
  error: string | null
}

export interface ModelDirectoryFacade {
  readonly store: {
    getSnapshot: () => ModelDirectoryState
    subscribe: (listener: () => void) => () => void
  }
  load: () => Promise<ModelDirectoryState>
  select: (selection: ModelSelection) => Promise<RemoteResult<void>>
}

export interface ModelDirectoriesService {
  directoryFor: (sessionId: string) => ModelDirectoryFacade
}

export type AcpClientContext = Context & {
  configForms: ConfigFormsService
  locale: LocaleService
  slots: SlotsService
  /** Internal service from `ui-model-selection`; injected lazily, absent on trimmed hosts. */
  modelDirectories: ModelDirectoriesService
  uiConversation: UiConversationService
  remote: {
    llm: LlmRemote
    $mount: (contribution: AcpSessionControlContribution) => Promise<() => Promise<void>>
    acpSessionControl: AcpSessionControlClient
  }
}
