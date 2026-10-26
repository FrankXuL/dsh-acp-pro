/**
 * Narrow projections of the official client services this plugin uses on DSH 0.2 cores
 * (`configForms` from dsh-client-ui-settings, `locale`, `slots`, and the `remote.llm`
 * Remote namespace). Only the members called here are declared.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ComponentType, ReactElement } from 'react'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'

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
  inject?: () => unknown
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

export type AcpClientContext = Context & {
  configForms: ConfigFormsService
  locale: LocaleService
  slots: SlotsService
  uiConversation: UiConversationService
  remote: { llm: LlmRemote }
}
