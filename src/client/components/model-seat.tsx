/**
 * The composer model picker: an icon rail of sources (favorites, the platform, every configured
 * ACP) over the shared `ModelDirectory`. The root mirrors the native two-step menu (model /
 * reasoning) and the trigger shows the owning ACP when the selection belongs to one.
 *
 * Favorites and the enabled/icon fields come from the plugin's settings document, so they survive
 * restarts and follow the profile rather than one browser origin.
 */
import type {
  ConfigForm, ConfigFormSnapshot, ModelDirectoryFacade, ModelDirectoryState, ModelSelection,
} from '../types/runtime.ts'
import { favoriteKey, favoritesOf as configuredFavorites, toggleFavoriteOps } from '../service/favorites.ts'
import { SourceIcon as SourceGlyph, tabName } from '../view/model-seat/rail.tsx'
import { ModelList } from '../view/model-seat/list.tsx'

import {
  DSH_TAB as SELECTION_DSH_TAB,
  FAVORITES_TAB as SELECTION_FAVORITES_TAB,
  effortName,
  isAcpSelection,
  modelMatcher,
  modelOf,
  modelsForTab,
  showsSearch,
  tabIdsOf,
  visibleGroupsOf,
} from '../service/selection.ts'
import type { AgentProfileView, SourceIcon } from '../service/model-seat-sources.ts'
import { agentProfilesOf, sourceRoutes } from '../service/model-seat-sources.ts'
import { anchorFor, rectMoved } from '../service/model-seat-anchor.ts'
import type { PanelAnchor, Rect } from '../service/model-seat-anchor.ts'
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

interface ModelSeatProps {
  sessionId: string
  locked?: boolean
  available?: boolean
  models?: ModelDirectoryFacade
  config?: ConfigForm
}

type Pane = 'root' | 'models' | 'efforts'

const FAVORITES_TAB = SELECTION_FAVORITES_TAB
const DSH_TAB = SELECTION_DSH_TAB

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
    () => tabIdsOf(state.groups, state.failures, agents),
    [agents, state.failures, state.groups],
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
  const isAcpCurrent = isAcpSelection(current, routes)

  const matches = useMemo(() => modelMatcher(query), [query])

  const sourceModels = useMemo(
    () => modelsForTab(tab, state.groups, routes, favoriteSet),
    [favoriteSet, routes, state.groups, tab],
  )

  const visibleGroups = useMemo(
    () => visibleGroupsOf(sourceModels.filter(({ model }) => matches(model))),
    [matches, sourceModels],
  )

  // Native rule: search appears when the full catalog exceeds four models, not per source.
  const showSearch = useMemo(() => showsSearch(state.groups), [state.groups])
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
          <SourceGlyph tab={current !== null && routes.includes(current.provider) ? current.provider : DSH_TAB} agents={agents} />
        </span>
        {triggerText}{busy ? ' …' : ' ▾'}
      </button>
      {open && anchor !== null && createPortal(
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
                    <SourceGlyph tab={id} agents={agents} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {pane !== 'root' && (
            <div className="dsh-model-seat-body">
              {pane === 'models'
                ? (
                  <ModelList
                    tab={tab}
                    query={query}
                    showSearch={showSearch}
                    busy={busy}
                    loading={state.status === 'loading'}
                    error={error}
                    failure={tabFailure}
                    groups={visibleGroups}
                    current={current}
                    pending={state.pending}
                    favoriteSet={favoriteSet}
                    onQuery={setQuery}
                    onChoose={choose}
                    onToggleFavorite={toggleFavorite}
                  />
                )
                : (
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
                  </div>
                )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </span>
  )
}
