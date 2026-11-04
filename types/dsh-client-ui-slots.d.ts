/**
 * The slice of `@deepseek-ai/dsh-client-ui-slots` (0.2.1-rc.5) the client uses.
 *
 * Like `dsh-client-ui-primitives`, this package is a platform seed: DSH's web module table hands
 * every client bundle the shell's own instance, so it is never installed here (its
 * `@deepseek-ai/cordis` peer range also excludes the alpha cordis this repo builds against).
 * Declarations are transcribed from the published `lib/types`, limited to the shape this plugin
 * consumes.
 *
 * Two merge points matter: `LocaleNamespaceMap` (this plugin adds `dshAcpPro`) and `SlotMap`
 * (the conversation and chat packages add their slot keys, transcribed here).
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** Merge-extensible map of locale namespaces to their key domains. */
  export interface LocaleNamespaceMap {
  }

  /** Merge-extensible map of slot keys to their declaration axes. */
  export interface SlotMap {
  }

  /**
   * One SlotMap entry: cardinality and scope axes, the optional owner share, the keyed
   * dispatch shares, and the injected face.
   */
  export interface SlotDeclaration {
    kind: 'single' | 'list' | 'keyed' | 'chain'
    scope: 'root' | 'session-maybe' | 'session'
    owner?: object
    keyProps?: object
    hookContext?: unknown
    inject?: object
  }

  /** Namespace-bound translate for one declared namespace. */
  export type TranslateNS<N extends keyof LocaleNamespaceMap & string> = (key: LocaleNamespaceMap[N] & string, params?: Record<string, unknown>) => string

  /** Locale share of the composed component props: the injected `t` seat. */
  export type PropsLocale<N> = N extends keyof LocaleNamespaceMap & string ? { t: TranslateNS<N> } : object

  /** Owner share of one slot key. */
  export type OwnerOf<K extends keyof SlotMap & string> = SlotMap[K] extends { owner: infer O extends object } ? O : object

  /** Registration/dispatch key domain of one keyed slot. */
  export type EntryKeyOf<K extends keyof SlotMap & string> = SlotMap[K] extends { kind: 'keyed', keyProps: infer P extends object } ? keyof P & string : string

  /** Key-dependent props supplied by the owner at one keyed dispatch site. */
  export type KeyPropsOf<K extends keyof SlotMap & string, EntryKey extends EntryKeyOf<K>> = SlotMap[K] extends { kind: 'keyed', keyProps: infer P extends object } ? EntryKey extends keyof P ? P[EntryKey] extends object ? P[EntryKey] : never : never : object

  /** Common render-occurrence inject face of one slot key. */
  export type SlotInjectOf<K extends keyof SlotMap & string> = SlotMap[K] extends { inject: infer I extends object } ? I : object

  /** Scope axis of one slot key. */
  export type ScopeOf<K extends keyof SlotMap & string> = SlotMap[K] extends { scope: infer S } ? S : 'root'

  /** Session-scope standard kit; each UI adapter merges its own members. */
  export interface SessionStandardProps {
  }

  /** Standard props selected by one declared scope. */
  export type ScopeStandardProps<S> = S extends 'session' ? SessionStandardProps : object

  /** Runtime props share: owner share, keyed share, injected face, and the standard kit. */
  export type PropsRuntime<K extends keyof SlotMap & string, EntryKey extends EntryKeyOf<K> = EntryKeyOf<K>>
    = OwnerOf<K> & KeyPropsOf<K, EntryKey> & SlotInjectFace<SlotInjectOf<K>> & ScopeStandardProps<ScopeOf<K>>

  /** Component-side view of an inject face; the `hooks` compartment is not used here. */
  export type InjectFace<I extends object> = I

  /** Component-side view of a slot dispatcher's inject face. */
  export type SlotInjectFace<I extends object> = I
}
