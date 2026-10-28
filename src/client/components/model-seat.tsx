/**
 * The composer model picker: an icon rail of sources (favorites, the platform, every configured
 * ACP) over the shared `ModelDirectory`. The root mirrors the native two-step menu (model /
 * reasoning) and the trigger shows the owning ACP when the selection belongs to one.
 *
 * Favorites and the enabled/icon fields come from the plugin's settings document, so they survive
 * restarts and follow the profile rather than one browser origin.
 */
import type { ReactElement } from 'react'
import type {
  AcpModelFavorite, ConfigForm, ConfigFormSnapshot, ModelDirectoryFacade, ModelDirectoryState, ModelInfo, ModelProviderGroup, ModelSelection,
} from '../types/runtime.ts'
import { favoriteKey, favoritesOf as configuredFavorites, toggleFavoriteOps } from '../service/favorites.ts'
import type { AgentProfileView, SourceIcon } from '../service/model-seat-sources.ts'
import { agentProfilesOf, resolveSourceIcon, sourceRoutes } from '../service/model-seat-sources.ts'
import { MONOCHROME_PROVIDERS, providerIconUrl } from '../assets/provider-icons.ts'
import { anchorFor, rectMoved } from '../service/model-seat-anchor.ts'
import type { PanelAnchor, Rect } from '../service/model-seat-anchor.ts'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

interface ModelSeatProps {
  sessionId: string
  locked?: boolean
  available?: boolean
  models?: ModelDirectoryFacade
  config?: ConfigForm
}

type Pane = 'root' | 'models' | 'efforts'

const FAVORITES_TAB = '__favorites__'
const DSH_TAB = 'dsh'
const FAVORITES_KEY = 'dsh-acp-pro:prototype:favorites'

const EMPTY_STATE: ModelDirectoryState = {
  current: null,
  routable: null,
  groups: [],
  failures: [],
  status: 'idle',
  pending: null,
  error: null,
}

const EMPTY_CONFIG: ConfigFormSnapshot = {
  status: 'unavailable',
  value: undefined,
  base: undefined,
  user: undefined,
  revision: undefined,
  writable: false,
  mode: 'host',
}

const NOOP_SUBSCRIBE = (): (() => void) => () => {}

export const MODEL_SEAT_CSS = `
.dsh-model-seat{display:inline-flex;position:relative}
.dsh-model-seat-trigger{display:inline-flex;align-items:center;gap:5px;height:28px;background:none;border:none;border-radius:var(--dsw-radius-md,12px);color:var(--dsw-alias-label-primary,#eee);cursor:pointer;font:inherit;font-size:13px;padding:0 4px 0 8px;max-width:100%}
.dsh-model-seat-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.dsh-model-seat-trigger:disabled{color:var(--dsw-alias-label-dimmed,#777);cursor:default}
/* Card geometry mirrors the native model menu (ui-model-selection ModelSelect.module.css .menu). */
.dsh-model-seat-panel{box-sizing:border-box;position:fixed;z-index:1100;transition:none;will-change:left,bottom;contain:layout paint;display:flex;gap:2px;width:340px;height:360px;max-width:calc(100vw - 32px);max-height:min(360px,calc(100vh - 96px));overflow:hidden;padding:4px;border:0;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-menu-surface-fill,#232323);backdrop-filter:var(--dsw-menu-backdrop-filter,none);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,#3a3a3a);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.45));color:var(--dsw-alias-label-primary,#eee);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2,#555);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2,#777)}
.dsh-model-seat-panel[data-pane=root]{width:min(240px,calc(100vw - 32px));height:auto}
.dsh-model-seat-panel[data-pane=efforts]{width:min(240px,calc(100vw - 32px));height:auto;max-height:min(360px,calc(100vh - 96px))}
.dsh-model-seat-root{display:flex;flex-direction:column;gap:0;min-width:min(240px,calc(100vw - 32px));padding:2px 0}
.dsh-model-seat-rail{display:flex;flex-direction:column;align-items:center;gap:2px;width:32px;flex:none;padding:2px 0;overflow-y:auto}
.dsh-model-seat-rail-btn{width:28px;height:28px;flex:none;display:flex;align-items:center;justify-content:center;background:none;border:none;border-radius:var(--dsw-radius-md,12px);color:var(--dsw-alias-label-tertiary,#999);cursor:pointer;font:inherit}
.dsh-model-seat-rail-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#eee)}
.dsh-model-seat-rail-btn[data-active=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#fff)}
.dsh-model-seat-rail-btn[data-fav=true][data-active=true]{color:var(--dsw-alias-state-warning-primary,#f5c542)}
.dsh-model-seat-rail-glyph{font-size:12px;font-weight:600;line-height:1}
.dsh-model-seat-trigger-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-model-seat-brand{display:block;width:16px;height:16px;background:currentColor;mask-position:center;mask-repeat:no-repeat;mask-size:contain;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;-webkit-mask-size:contain}
.dsh-model-seat-brand-img{display:block;width:16px;height:16px;object-fit:contain}
.dsh-model-seat-divider{width:16px;height:1px;flex:none;background:var(--dsw-alias-border-l2,#333);margin:2px 0}
.dsh-model-seat-body{flex:1;min-width:180px;max-width:340px;min-height:0;display:flex;flex-direction:column}
.dsh-model-seat-search{box-sizing:border-box;flex:none;width:100%;height:auto;margin:2px 0 3px;padding:5px 7px;border:0 solid transparent;border-radius:var(--dsw-radius-md,12px);background:transparent;color:inherit;font:inherit;font-size:12px;outline:none}
.dsh-model-seat-search::placeholder{color:var(--dsw-alias-label-caption,#8a8a8a)}
.dsh-model-seat-list{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;overflow-y:auto}
.dsh-model-seat-group{position:sticky;top:0;z-index:1;padding:4px 7px 2px;background:var(--dsw-alias-menu-group-header-fill,rgba(48,49,54,.94));color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11px;line-height:16px;font-weight:500}
.dsh-model-seat-row{display:flex;align-items:center;gap:2px;min-width:100%}
.dsh-model-seat-model{box-sizing:border-box;flex:1;min-width:0;display:flex;align-items:center;gap:6px;min-height:34px;padding:5px 7px;border:none;border-radius:var(--dsw-radius-md,12px);background:transparent;color:inherit;cursor:pointer;font:inherit;text-align:left;outline:none}
.dsh-model-seat-model:hover,.dsh-model-seat-model:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.dsh-model-seat-model:disabled{color:var(--dsw-alias-label-dimmed,#777);cursor:default}
.dsh-model-seat-model-name{flex:1;min-width:0;overflow:hidden;color:inherit;font-size:13px;line-height:18px;font-weight:400;text-overflow:ellipsis;white-space:nowrap}
.dsh-model-seat-check{flex:0 0 14px;display:grid;place-items:center;color:var(--dsw-alias-label-primary,#eee);font-size:13px}
.dsh-model-seat-star{flex:none;width:24px;height:24px;display:grid;place-items:center;padding:0;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);cursor:pointer;font-size:13px;opacity:0}
.dsh-model-seat-row:hover .dsh-model-seat-star,.dsh-model-seat-star[data-on=true],.dsh-model-seat-star:focus-visible{opacity:1}
.dsh-model-seat-star:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#eee)}
.dsh-model-seat-star[data-on=true]{color:var(--dsw-alias-state-warning-primary,#f5c542)}
/* Root cells mirror .cell: 34px high, 0 8px padding, 13/20 text. */
.dsh-model-seat-cell{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:auto;min-width:100%;height:34px;padding:0 8px;border:none;border-radius:var(--dsw-radius-md,12px);background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;cursor:pointer;text-align:left;outline:none}
.dsh-model-seat-cell:hover,.dsh-model-seat-cell:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.dsh-model-seat-cell-label{flex:0 0 auto;white-space:nowrap}
.dsh-model-seat-cell-value{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.dsh-model-seat-cell-chevron{flex:0 0 auto;width:12px;height:12px;color:var(--dsw-alias-menu-icon,#8a8a8a)}
.dsh-model-seat-hint{padding:8px;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12px;line-height:18px}
.dsh-model-seat-error{padding:6px 7px;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(255,80,80,.14));color:var(--dsw-alias-state-error-primary,#f66);font-size:11px;line-height:16px}
.dsh-model-seat-rail-slot{display:contents}
`

function groupOf(groups: readonly ModelProviderGroup[], id: string): ModelProviderGroup | undefined {
  return groups.find(group => group.id === id)
}

function modelOf(groups: readonly ModelProviderGroup[], selection: ModelSelection | null): ModelInfo | undefined {
  if (selection === null)
    return undefined
  return groupOf(groups, selection.provider)?.models.find(model => model.id === selection.model)
}

function effortName(model: ModelInfo | undefined, effortId: string | undefined): string | undefined {
  if (model === undefined || effortId === undefined)
    return undefined
  return model.reasoning?.efforts.find(effort => effort.id === effortId)?.name ?? effortId
}

/** Minimal inline glyph per source; brand-ish marks by name, then a letter fallback. */
const FAVORITES_ICON = <path d="M12 3.7l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.72l-5.1 2.68.97-5.68L3.75 9.7l5.7-.83z" />
/** The platform source is DSH itself, so its mark is the native fish silhouette. */
function PlatformIcon(): ReactElement {
  return (
    <svg
      width={17}
      height={17}
      viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <path d={FISH_LOGO_PATH} fill="currentColor" />
    </svg>
  )
}

/** One rail glyph: favorites star, platform mark, or the configured/detected provider mark. */
function SourceIcon({ tab, agents }: { tab: string, agents: Record<string, AgentProfileView> }): ReactElement {
  const common = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (tab === FAVORITES_TAB)
    return <svg {...common} fill="currentColor" stroke="none">{FAVORITES_ICON}</svg>
  if (tab === DSH_TAB)
    return <PlatformIcon />
  const glyph: SourceIcon = resolveSourceIcon(agents[tab] ?? {}, tab)
  if (glyph.kind === 'builtin') {
    const url = providerIconUrl(glyph.name)
    if (url !== undefined) {
      // Monochrome marks follow the label colour so they survive a light theme; the rest keep
      // their own colours and are drawn as images.
      return MONOCHROME_PROVIDERS.has(glyph.name)
        ? <span className="dsh-model-seat-brand" style={{ maskImage: `url("${url}")`, WebkitMaskImage: `url("${url}")` }} />
        : <img className="dsh-model-seat-brand-img" src={url} alt="" draggable={false} width={16} height={16} />
    }
  }
  if (glyph.kind === 'url')
    return <img className="dsh-model-seat-rail-img" src={glyph.url} alt="" width={16} height={16} />
  if (glyph.kind === 'builtin')
    return <span className="dsh-model-seat-rail-glyph">{glyph.name.slice(0, 1).toUpperCase()}</span>
  return <span className="dsh-model-seat-rail-glyph">{glyph.text}</span>
}

function tabName(tab: string, agents: Record<string, AgentProfileView>): string {
  if (tab === FAVORITES_TAB)
    return '收藏'
  if (tab === DSH_TAB)
    return 'DSH'
  return agents[tab]?.displayName ?? tab
}

export function ModelSeat(props: ModelSeatProps): ReactElement | null {
  const directory = props.models
  const form = props.config
  const store = directory?.store
  // ConfigForm/Store methods read their own `this`; never hand them to React unbound.
  const storeSubscribe = useMemo(() => store === undefined ? NOOP_SUBSCRIBE : (listener: () => void) => store.subscribe(listener), [store])
  const storeGetSnapshot = useMemo(() => store === undefined ? () => EMPTY_STATE : () => store.getSnapshot(), [store])
  const formSubscribe = useMemo(() => form === undefined ? NOOP_SUBSCRIBE : (listener: () => void) => form.subscribe(listener), [form])
  const formGetSnapshot = useMemo(() => form === undefined ? () => EMPTY_CONFIG : () => form.getSnapshot(), [form])
  const state = useSyncExternalStore(storeSubscribe, storeGetSnapshot, storeGetSnapshot)
  const configSnapshot = useSyncExternalStore(formSubscribe, formGetSnapshot, formGetSnapshot)
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const [tab, setTab] = useState<string>(DSH_TAB)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const favorites = useMemo(() => configuredFavorites(configSnapshot), [configSnapshot])
  const [anchor, setAnchor] = useState<PanelAnchor | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  /** Last measured trigger rect, so a layout shift can be compared across observers. */
  const lastTriggerRect = useRef<Rect | undefined>(undefined)
  /** Panel size the last pane rendered at; the anchor clamps against the real box, not a guess. */
  const lastPanelSize = useRef<{ width: number, height: number } | undefined>(undefined)

  const agents = useMemo(() => agentProfilesOf(configSnapshot), [configSnapshot])
  const routes = useMemo(() => sourceRoutes(configSnapshot), [configSnapshot])
  const groupById = useMemo(() => new Map(state.groups.map(group => [group.id, group])), [state.groups])
  const failureById = useMemo(() => new Map(state.failures.map(failure => [failure.id, failure])), [state.failures])
  const tabIds = useMemo(
    () => [FAVORITES_TAB, DSH_TAB, ...routes.filter(route => groupById.has(route) || failureById.has(route))],
    [failureById, groupById, routes],
  )
  useEffect(() => {
    if (!tabIds.includes(tab))
      setTab(DSH_TAB)
  }, [tab, tabIds])

  const current = state.current
  const currentModel = modelOf(state.groups, current)
  const currentEffort = current === null ? undefined : current.reasoningEffort
  const effortChoices = currentModel?.reasoning?.efforts ?? []
  const busy = state.pending !== null || state.status === 'selecting'
  const favoriteSet = useMemo(
    () => new Set(favorites.map(item => favoriteKey(item.provider, item.model))),
    [favorites],
  )
  const isAcpCurrent = current !== null && routes.includes(current.provider)

  const matches = useCallback((model: ModelInfo): boolean => {
    const needle = query.trim().toLowerCase()
    return needle.length === 0 || model.name.toLowerCase().includes(needle)
  }, [query])

  const sourceModels = useMemo(() => {
    if (tab === FAVORITES_TAB) {
      return state.groups.flatMap(group =>
        group.models
          .filter(model => favoriteSet.has(favoriteKey(group.id, model.id)))
          .map(model => ({ group, model })),
      )
    }
    const inSource = state.groups.filter(group => tab === DSH_TAB ? !routes.includes(group.id) : group.id === tab)
    return inSource.flatMap(group => group.models.map(model => ({ group, model })))
  }, [favoriteSet, routes, state.groups, tab])

  const visibleGroups = useMemo(() => {
    const filtered = sourceModels.filter(({ model }) => matches(model))
    const byGroup = new Map<string, { group: ModelProviderGroup, models: ModelInfo[] }>()
    for (const { group, model } of filtered) {
      const entry = byGroup.get(group.id) ?? { group, models: [] }
      entry.models.push(model)
      byGroup.set(group.id, entry)
    }
    return [...byGroup.values()]
  }, [matches, sourceModels])

  // Native rule: search appears when the full catalog exceeds four models (not per source),
  // so a small ACP tab inside a large catalog still gets a search entry.
  const totalModels = useMemo(() => state.groups.reduce((count, group) => count + group.models.length, 0), [state.groups])
  const showSearch = totalModels > 4
  const tabFailure = tab !== DSH_TAB && tab !== FAVORITES_TAB ? failureById.get(tab) : undefined

  const toggleFavorite = useCallback((provider: string, model: string) => {
    if (form === undefined)
      return
    // One whole-array `set`: rapid clicks can never interleave into a half-written list, and the
    // settings document (not this component) stays the source of truth.
    const ops = toggleFavoriteOps(configuredFavorites(form.getSnapshot()), provider, model)
    void form.mutate(ops)
  }, [form])

  /**
   * Re-anchor the panel. During a drag this runs every animation frame, so it writes the fixed
   * coordinates straight to the DOM: routing each frame through `setState` made React's render lag
   * behind the pointer by a frame or two, which read as "not tracking".
   */
  const reposition = useCallback((force = false): void => {
    const trigger = triggerRef.current?.getBoundingClientRect()
    if (trigger === undefined)
      return
    const rect: Rect = { left: trigger.left, right: trigger.right, top: trigger.top, bottom: trigger.bottom, width: trigger.width, height: trigger.height }
    // The composer moves on its own too (sidebar drag, transcript growth, window resize), so an
    // unchanged trigger still needs a re-anchor when the panel size changed.
    // Measure the panel's natural size: an already-clamped `max-width` would otherwise feed the
    // previous, narrower box back in and lock the card at the root pane's width.
    const element = panelRef.current
    let size: { width: number, height: number } | undefined
    if (element !== null) {
      const previousMaxWidth = element.style.maxWidth
      element.style.maxWidth = 'none'
      const natural = element.getBoundingClientRect()
      element.style.maxWidth = previousMaxWidth
      if (natural.width > 0)
        size = { width: natural.width, height: natural.height }
    }
    const sizeChanged = size !== undefined && lastPanelSize.current !== undefined
      && (size.width !== lastPanelSize.current.width || size.height !== lastPanelSize.current.height)
    if (!force && !sizeChanged && !rectMoved(lastTriggerRect.current, rect))
      return
    lastTriggerRect.current = rect
    if (size !== undefined)
      lastPanelSize.current = size
    const natural = measuredPanelSize(pane)
    // `max` keeps a measurement taken while the card was clamped from shrinking this pane.
    const measured = size === undefined ? natural : { width: Math.max(size.width, natural.width), height: Math.max(size.height, natural.height) }
    const next = anchorFor(rect, { width: window.innerWidth, height: window.innerHeight }, measured, natural.width)
    // Apply immediately, then keep the React state in step for the next render.
    if (panelRef.current !== null) {
      panelRef.current.style.left = `${next.left}px`
      panelRef.current.style.bottom = `${next.bottom}px`
      panelRef.current.style.maxHeight = `${next.maxHeight}px`
      panelRef.current.style.maxWidth = `${next.maxWidth}px`
    }
    setAnchor(current => current !== null
      && current.left === next.left
      && current.bottom === next.bottom
      && current.maxHeight === next.maxHeight
      && current.maxWidth === next.maxWidth
      ? current
      : next)
  }, [pane])

/** Panel size per pane; only used until the real box has been measured once. */
function measuredPanelSize(pane: Pane): { width: number, height: number } {
  return pane === 'models' ? { width: 340, height: 360 } : { width: 240, height: 120 }
}

  const openMenu = useCallback(() => {
    setPane('root')
    setOpen(true)
    setError(null)
    setQuery('')
    if (directory === undefined) {
      setError('模型目录不可用：缺少 modelDirectories 服务')
      return
    }
    void directory.load().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [directory])

  // A pane switch changes the card's natural size, so stale measurements must not be reused: drop
  // them and re-anchor with the new pane's own width (the models card must not inherit the root
  // pane's narrow box).
  useEffect(() => {
    lastPanelSize.current = undefined
    lastTriggerRect.current = undefined
    if (open) {
      reposition(true)
      // The panel is only measurable after this render; re-anchor once more on the next frame.
      const frame = requestAnimationFrame(() => reposition(true))
      return () => cancelAnimationFrame(frame)
    }
    return undefined
  }, [open, pane, reposition])

  useEffect(() => {
    if (!open)
      return
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target === null)
        return
      if (triggerRef.current?.contains(target) === true || panelRef.current?.contains(target) === true)
        return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape')
        return
      if (pane !== 'root')
        setPane('root')
      else
        setOpen(false)
    }
    const onLayoutChange = (): void => reposition()
    // A dragged sidebar moves the composer without resizing it and without any event: neither
    // `resize` nor ResizeObserver fires. Watching the trigger's rect every frame is the only way
    // to keep the fixed-position panel glued to it while a drag is in progress.
    let frame = 0
    const follow = (): void => {
      reposition()
      frame = requestAnimationFrame(follow)
    }
    frame = requestAnimationFrame(follow)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(onLayoutChange)
    if (observer !== undefined && triggerRef.current !== null)
      observer.observe(triggerRef.current)
    window.addEventListener('resize', onLayoutChange)
    document.addEventListener('scroll', onLayoutChange, true)
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', onLayoutChange)
      document.removeEventListener('scroll', onLayoutChange, true)
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, pane, reposition])

  const choose = useCallback((selection: ModelSelection) => {
    setError(null)
    if (directory === undefined) {
      setError('模型目录不可用：缺少 modelDirectories 服务')
      return
    }
    void directory.select(selection).then((result) => {
      // The host either accepts the selection, or refuses the effort for this exact model.
      // Logging the outcome makes a refused effort visible instead of an apparently dead click.
      if (result.ok) {
        console.info(`[dsh-acp-pro] model selection accepted: ${selection.provider}/${selection.model} effort=${selection.reasoningEffort ?? '(default)'}`)
        setOpen(false)
        return
      }
      console.warn(`[dsh-acp-pro] model selection refused: ${result.error.code}: ${result.error.message} (${selection.provider}/${selection.model} effort=${selection.reasoningEffort ?? '(default)'})`)
      setError(`${result.error.code}: ${result.error.message}`)
    })
  }, [directory])

  if (props.available === false)
    return null

  const acpName = current !== null && routes.includes(current.provider)
    ? agents[current.provider]?.displayName ?? current.provider
    : undefined
  const modelLabel = currentModel?.name ?? current?.model ?? '选择模型'
  const effortLabel = currentEffort === undefined ? undefined : effortName(currentModel, currentEffort) ?? currentEffort
  const triggerText = `${acpName === undefined ? '' : `${acpName} · `}${modelLabel}${effortLabel === undefined ? '' : ` · ${effortLabel}`}`

  return (
    <span className="dsh-model-seat">
      <button
        ref={triggerRef}
        type="button"
        className="dsh-model-seat-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={props.locked === true}
        onClick={() => {
          if (open)
            setOpen(false)
          else
            openMenu()
        }}
        title="选择模型与推理等级"
      >
        <span className="dsh-model-seat-trigger-icon" aria-hidden="true">
          <SourceIcon tab={current !== null && routes.includes(current.provider) ? current.provider : DSH_TAB} agents={agents} />
        </span>
        {triggerText}{busy ? ' …' : ' ▾'}
      </button>
      {open && anchor !== null && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="模型与推理"
          className="dsh-model-seat-panel"
          data-pane={pane}
          style={{ left: anchor.left, bottom: anchor.bottom, maxHeight: anchor.maxHeight, maxWidth: anchor.maxWidth }}
        >
          {pane === 'root' && (
            <div className="dsh-model-seat-root">
              <button type="button" className="dsh-model-seat-cell" onClick={() => setPane('models')}>
                <span className="dsh-model-seat-cell-label">模型</span>
                <span className="dsh-model-seat-cell-value">{modelLabel}</span>
                <span className="dsh-model-seat-cell-chevron">›</span>
              </button>
              {effortChoices.length > 0 && (
                <button type="button" className="dsh-model-seat-cell" onClick={() => setPane('efforts')}>
                  <span className="dsh-model-seat-cell-label">推理</span>
                  <span className="dsh-model-seat-cell-value">{effortLabel ?? '默认'}</span>
                  <span className="dsh-model-seat-cell-chevron">›</span>
                </button>
              )}
            </div>
          )}
          {pane === 'models' && (
            <div role="tablist" aria-orientation="vertical" aria-label="来源" className="dsh-model-seat-rail">
              {tabIds.map((id, index) => (
                <div key={id} className="dsh-model-seat-rail-slot">
                  {index === 1 && <div className="dsh-model-seat-divider" />}
                  <button
                    type="button"
                    role="tab"
                    className="dsh-model-seat-rail-btn"
                    data-active={tab === id}
                    data-fav={id === FAVORITES_TAB}
                    aria-selected={tab === id}
                    aria-label={tabName(id, agents)}
                    title={tabName(id, agents)}
                    onClick={() => {
                      setTab(id)
                      setQuery('')
                    }}
                  >
                    <SourceIcon tab={id} agents={agents} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {pane !== 'root' && (
            <div className="dsh-model-seat-body">
              {pane === 'models' && showSearch && (
                <input
                  className="dsh-model-seat-search"
                  value={query}
                  placeholder="搜索当前来源"
                  onChange={event => setQuery(event.target.value)}
                />
              )}
              <div className="dsh-model-seat-list">
                {pane === 'efforts' && effortChoices.map(effortOption => (
                  <div key={effortOption.id} className="dsh-model-seat-row">
                    <button
                      type="button"
                      className="dsh-model-seat-model"
                      data-selected={currentEffort === effortOption.id}
                      disabled={busy}
                      onClick={() => current === null ? undefined : choose({ ...current, reasoningEffort: effortOption.id })}
                    >
                      <span className="dsh-model-seat-model-name">{effortOption.name}</span>
                      <span className="dsh-model-seat-check">{currentEffort === effortOption.id ? '✓' : ''}</span>
                    </button>
                  </div>
                ))}
                {pane === 'models' && (
                  <>
                    {state.status === 'loading' && <div className="dsh-model-seat-hint">加载中…</div>}
                    {tabFailure !== undefined && <div className="dsh-model-seat-error">{tabFailure.name}：{tabFailure.message}</div>}
                    {visibleGroups.map(entry => (
                      <div key={entry.group.id}>
                        {visibleGroups.length > 1 && <div className="dsh-model-seat-group">{entry.group.name}</div>}
                              {entry.models.map(model => {
                          const selected = current !== null && current.provider === entry.group.id && current.model === model.id
                          const pending = state.pending !== null && state.pending.provider === entry.group.id && state.pending.model === model.id
                          const favorite = favoriteSet.has(favoriteKey(entry.group.id, model.id))
                          return (
                            <div key={model.id} className="dsh-model-seat-row">
                              <button
                                type="button"
                                role="menuitemradio"
                                className="dsh-model-seat-model"
                                data-selected={selected}
                                aria-checked={selected}
                                disabled={busy}
                                onClick={() => choose({ provider: entry.group.id, model: model.id })}
                              >
                                <span className="dsh-model-seat-model-name">{model.name}</span>
                                <span className="dsh-model-seat-check">{pending ? '…' : selected ? '✓' : ''}</span>
                              </button>
                              <button
                                type="button"
                                className="dsh-model-seat-star"
                                data-on={favorite}
                                aria-label={favorite ? '取消收藏' : '收藏'}
                                title={favorite ? '取消收藏' : '收藏'}
                                disabled={busy}
                                onClick={() => toggleFavorite(entry.group.id, model.id)}
                              >
                                {favorite ? '★' : '☆'}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                    {visibleGroups.length === 0 && (
                      <div className="dsh-model-seat-hint">
                        {tab === FAVORITES_TAB
                          ? '还没有收藏的模型。'
                          : query.trim().length > 0 ? '没有匹配的模型。' : state.status === 'loading' ? '' : '暂无可用模型。'}
                      </div>
                    )}
                  </>
                )}
                {error !== null && <div className="dsh-model-seat-error">{error}</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  )
}
