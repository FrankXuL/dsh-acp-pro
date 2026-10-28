/**
 * PROTOTYPE v6 (`wayfinder` ticket #04): compact icon-rail model picker that mirrors the native
 * two-step root (模型 / 推理), matching native row heights, and shows the ACP name on the trigger.
 * Favorites are localStorage-only for the prototype; persistence is ticket #07.
 */
import type { ReactElement } from 'react'
import type {
  ConfigForm, ConfigFormSnapshot, JsonValue, ModelDirectoryFacade, ModelDirectoryState, ModelInfo, ModelProviderGroup, ModelSelection,
} from '../types/runtime.ts'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

interface ProtoSeatProps {
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

export const PROTO_CSS = `
.dsh-proto-seat{display:inline-flex;position:relative}
.dsh-proto-trigger{display:inline-flex;align-items:center;gap:4px;height:28px;background:none;border:none;border-radius:6px;color:var(--dsw-alias-label-primary,#eee);cursor:pointer;font:inherit;font-size:13px;padding:0 8px;max-width:100%}
.dsh-proto-trigger:hover{background:var(--dsw-alias-fill-tsp-secondary,#2a2a2a)}
.dsh-proto-trigger:disabled{opacity:.5;cursor:default}
.dsh-proto-panel{position:fixed;z-index:2147483000;display:flex;gap:6px;width:min(440px,92vw);max-width:min(560px,92vw);max-height:min(440px,70vh);padding:4px;border-radius:12px;background:var(--dsw-alias-bg-module-platform,#1f1f1f);border:1px solid var(--dsw-alias-border-l2,#333);box-shadow:0 12px 40px rgba(0,0,0,.45)}
.dsh-proto-panel[data-pane=root],.dsh-proto-panel[data-pane=efforts]{width:min(280px,90vw)}
.dsh-proto-rail{display:flex;flex-direction:column;align-items:center;gap:2px;width:40px;flex:none;padding:2px 0;overflow-y:auto}
.dsh-proto-rail-btn{width:34px;height:34px;flex:none;display:flex;align-items:center;justify-content:center;background:none;border:none;border-radius:9px;color:var(--dsw-alias-label-tertiary,#999);cursor:pointer;font:inherit}
.dsh-proto-rail-btn:hover{background:var(--dsw-alias-fill-tsp-secondary,#2a2a2a);color:var(--dsw-alias-label-primary,#eee)}
.dsh-proto-rail-btn[data-active=true]{background:var(--dsw-alias-fill-tsp-secondary,#2a2a2a);color:var(--dsw-alias-label-primary,#fff)}
.dsh-proto-rail-btn[data-fav=true][data-active=true]{color:var(--dsw-alias-state-warning-primary,#f5c542)}
.dsh-proto-rail-glyph{font-size:13px;font-weight:600;line-height:1}
.dsh-proto-divider{width:20px;height:1px;flex:none;background:var(--dsw-alias-border-l2,#333);margin:3px 0}
.dsh-proto-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-proto-back{flex:none;width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:none;border:none;border-radius:6px;color:var(--dsw-alias-label-tertiary,#999);cursor:pointer;font-size:15px;line-height:1;padding:0}
.dsh-proto-back:hover{background:var(--dsw-alias-fill-tsp-secondary,#2a2a2a);color:var(--dsw-alias-label-primary,#eee)}
.dsh-proto-pane-head{display:flex;align-items:center;gap:4px;min-height:26px}
.dsh-proto-search{box-sizing:border-box;width:100%;border:none;outline:none;border-radius:7px;background:var(--dsw-alias-fill-tsp-secondary,#2a2a2a);color:var(--dsw-alias-label-primary,#eee);font:inherit;font-size:12.5px;padding:6px 8px;margin:1px 0}
.dsh-proto-search::placeholder{color:var(--dsw-alias-label-tertiary,#888)}
.dsh-proto-list{display:flex;flex-direction:column;gap:1px;overflow-y:auto;min-height:0;padding-right:1px}
.dsh-proto-group{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#888);padding:6px 6px 1px}
.dsh-proto-row{display:flex;align-items:center;gap:1px;min-height:34px}
.dsh-proto-model{flex:1;min-width:0;display:flex;align-items:center;gap:6px;min-height:34px;background:none;border:none;border-radius:7px;color:var(--dsw-alias-label-primary,#eee);cursor:pointer;font:inherit;font-size:13px;line-height:20px;padding:0 8px;text-align:left}
.dsh-proto-model:hover{background:var(--dsw-alias-fill-tsp-secondary,#2a2a2a)}
.dsh-proto-model[data-selected=true]{background:var(--dsw-alias-fill-tsp-secondary,#2a2a2a)}
.dsh-proto-model:disabled{opacity:.55;cursor:default}
.dsh-proto-model-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-proto-check{flex:none;color:var(--dsw-alias-label-secondary,#bbb);font-size:12px}
.dsh-proto-star{flex:none;width:28px;height:34px;display:flex;align-items:center;justify-content:center;background:none;border:none;border-radius:7px;cursor:pointer;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;opacity:.7}
.dsh-proto-star:hover{background:var(--dsw-alias-fill-tsp-secondary,#2a2a2a);opacity:1}
.dsh-proto-star[data-on=true]{color:var(--dsw-alias-state-warning-primary,#f5c542);opacity:1}
.dsh-proto-root{display:flex;flex-direction:column;gap:1px;padding:2px}
.dsh-proto-root-row{display:flex;align-items:center;gap:10px;min-height:34px;background:none;border:none;border-radius:7px;color:var(--dsw-alias-label-primary,#eee);cursor:pointer;font:inherit;font-size:13px;line-height:20px;padding:0 8px;text-align:left}
.dsh-proto-root-row:hover{background:var(--dsw-alias-fill-tsp-secondary,#2a2a2a)}
.dsh-proto-root-label{flex:none;color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-proto-root-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsw-alias-label-tertiary,#999);font-size:12px}
.dsh-proto-root-chevron{flex:none;color:var(--dsw-alias-label-tertiary,#888);font-size:14px}
.dsh-proto-hint{font-size:12px;color:var(--dsw-alias-label-tertiary,#888);padding:8px}
.dsh-proto-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#f66);padding:6px 8px}
.dsh-proto-rail-slot{display:contents}
`

interface AgentProfileView { displayName?: string }

function agentsOf(value: JsonValue | undefined): Record<string, AgentProfileView> {
  const agents = (value as { agents?: unknown } | undefined)?.agents
  return typeof agents === 'object' && agents !== null && !Array.isArray(agents)
    ? agents as Record<string, AgentProfileView>
    : {}
}

function favoriteKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

function readFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  }
  catch {
    return []
  }
}

function writeFavorites(keys: readonly string[]): void {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(keys))
  }
  catch {
    // Prototype only.
  }
}

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
function SourceIcon({ tab, agents }: { tab: string, agents: Record<string, AgentProfileView> }): ReactElement {
  const common = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (tab === FAVORITES_TAB) {
    return (
      <svg {...common} fill="currentColor" stroke="none">
        <path d="M12 3.7l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.72l-5.1 2.68.97-5.68L3.75 9.7l5.7-.83z" />
      </svg>
    )
  }
  if (tab === DSH_TAB) {
    return (
      <svg {...common}>
        <path d="M12 3.5l7 8.5-7 8.5-7-8.5z" />
      </svg>
    )
  }
  const name = (agents[tab]?.displayName ?? tab).toLowerCase()
  if (name.includes('claude'))
    return <svg {...common}><path d="M12 4v16M5.2 8l13.6 8M18.8 8L5.2 16" /></svg>
  if (name.includes('codex') || name.includes('gpt') || name.includes('openai')) {
    return <svg {...common}><path d="M12 3.6l6.9 4v8.8l-6.9 4-6.9-4V7.6z" /><path d="M12 8.2v7.6" /></svg>
  }
  if (name.includes('gemini'))
    return <svg {...common}><path d="M12 3.5l2.1 6.4 6.4 2.1-6.4 2.1L12 20.5l-2.1-6.4L3.5 12l6.4-2.1z" /></svg>
  if (name.includes('deepseek'))
    return <svg {...common}><path d="M4 14c2.2-3.2 4.4-3.2 6.6 0s4.4 3.2 6.6 0 3.4-2.6 4.8-1.2" /></svg>
  if (name.includes('auto'))
    return <svg {...common}><path d="M13 3.5L5.5 13h5l-1.5 7.5L18 10.5h-5z" /></svg>
  if (name.includes('open') || name.includes('code'))
    return <svg {...common}><path d="M9 5l-5 7 5 7M15 5l5 7-5 7" /></svg>
  const initial = (agents[tab]?.displayName ?? tab).trim()
  return <span className="dsh-proto-rail-glyph">{initial.length === 0 ? '?' : initial[0]!.toUpperCase()}</span>
}

function tabName(tab: string, agents: Record<string, AgentProfileView>): string {
  if (tab === FAVORITES_TAB)
    return '收藏'
  if (tab === DSH_TAB)
    return 'DSH'
  return agents[tab]?.displayName ?? tab
}

export function ModelSeatProto(props: ProtoSeatProps): ReactElement | null {
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
  const [favorites, setFavorites] = useState<string[]>(readFavorites)
  const [anchor, setAnchor] = useState<{ left: number, bottom: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const agents = useMemo(() => agentsOf(configSnapshot.value), [configSnapshot.value])
  const routes = useMemo(
    () => Object.keys(agents).sort((left, right) => {
      const a = agents[left]?.displayName ?? left
      const b = agents[right]?.displayName ?? right
      return a.localeCompare(b) || left.localeCompare(right)
    }),
    [agents],
  )
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
  const favoriteSet = useMemo(() => new Set(favorites), [favorites])
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

  const showSearch = sourceModels.length > 4
  const tabFailure = tab !== DSH_TAB && tab !== FAVORITES_TAB ? failureById.get(tab) : undefined

  const toggleFavorite = useCallback((provider: string, model: string) => {
    const key = favoriteKey(provider, model)
    setFavorites((previous) => {
      const next = previous.includes(key) ? previous.filter(item => item !== key) : [key, ...previous]
      writeFavorites(next)
      return next
    })
  }, [])

  const reposition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect === undefined)
      return
    const width = pane === 'root' || pane === 'efforts' ? 280 : 440
    setAnchor({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      bottom: Math.max(8, window.innerHeight - rect.top + 8),
    })
  }, [pane])

  const openMenu = useCallback(() => {
    setPane('root')
    setOpen(true)
    setError(null)
    setQuery('')
    if (directory === undefined) {
      setError('prototype: model directory 未注入')
      return
    }
    void directory.load().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [directory])

  useEffect(() => {
    if (!open)
      return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect !== undefined) {
      const width = pane === 'root' || pane === 'efforts' ? 280 : 440
      setAnchor({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        bottom: Math.max(8, window.innerHeight - rect.top + 8),
      })
    }
  }, [open, pane])

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
    window.addEventListener('resize', reposition)
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', reposition)
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, pane, reposition])

  const choose = useCallback((selection: ModelSelection) => {
    setError(null)
    if (directory === undefined) {
      setError('prototype: model directory 未注入')
      return
    }
    void directory.select(selection).then((result) => {
      if (result.ok)
        setOpen(false)
      else
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
    <span className="dsh-proto-seat">
      <button
        ref={triggerRef}
        type="button"
        className="dsh-proto-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={props.locked === true}
        onClick={() => {
          if (open)
            setOpen(false)
          else
            openMenu()
        }}
        title="PROTOTYPE v6"
      >
        {triggerText}{busy ? ' …' : ' ▾'}
      </button>
      {open && anchor !== null && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="模型与推理"
          className="dsh-proto-panel"
          data-pane={pane}
          style={{ left: anchor.left, bottom: anchor.bottom }}
        >
          {pane === 'root' && (
            <div className="dsh-proto-root">
              <button type="button" className="dsh-proto-root-row" onClick={() => setPane('models')}>
                <span className="dsh-proto-root-label">模型</span>
                <span className="dsh-proto-root-value">{modelLabel}</span>
                <span className="dsh-proto-root-chevron">›</span>
              </button>
              {effortChoices.length > 0 && (
                <button type="button" className="dsh-proto-root-row" onClick={() => setPane('efforts')}>
                  <span className="dsh-proto-root-label">推理</span>
                  <span className="dsh-proto-root-value">{effortLabel ?? '默认'}</span>
                  <span className="dsh-proto-root-chevron">›</span>
                </button>
              )}
            </div>
          )}
          {pane === 'models' && (
            <div role="tablist" aria-orientation="vertical" aria-label="来源" className="dsh-proto-rail">
              {tabIds.map((id, index) => (
                <div key={id} className="dsh-proto-rail-slot">
                  {index === 1 && <div className="dsh-proto-divider" />}
                  <button
                    type="button"
                    role="tab"
                    className="dsh-proto-rail-btn"
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
            <div className="dsh-proto-body">
              <div className="dsh-proto-pane-head">
                <button type="button" className="dsh-proto-back" aria-label="返回" onClick={() => setPane('root')}>‹</button>
              </div>
              {pane === 'models' && showSearch && (
                <input
                  className="dsh-proto-search"
                  value={query}
                  placeholder="搜索当前来源"
                  onChange={event => setQuery(event.target.value)}
                />
              )}
              <div className="dsh-proto-list">
                {pane === 'efforts' && effortChoices.map(effortOption => (
                  <div key={effortOption.id} className="dsh-proto-row">
                    <button
                      type="button"
                      className="dsh-proto-model"
                      data-selected={currentEffort === effortOption.id}
                      disabled={busy}
                      onClick={() => current === null ? undefined : choose({ ...current, reasoningEffort: effortOption.id })}
                    >
                      <span className="dsh-proto-model-name">{effortOption.name}</span>
                      <span className="dsh-proto-check">{currentEffort === effortOption.id ? '✓' : ''}</span>
                    </button>
                  </div>
                ))}
                {pane === 'models' && (
                  <>
                    {state.status === 'loading' && <div className="dsh-proto-hint">加载中…</div>}
                    {tabFailure !== undefined && <div className="dsh-proto-error">{tabFailure.name}：{tabFailure.message}</div>}
                    {visibleGroups.map(entry => (
                      <div key={entry.group.id}>
                        {(tab === DSH_TAB || visibleGroups.length > 1) && <div className="dsh-proto-group">{entry.group.name}</div>}
                        {entry.models.map(model => {
                          const selected = current !== null && current.provider === entry.group.id && current.model === model.id
                          const pending = state.pending !== null && state.pending.provider === entry.group.id && state.pending.model === model.id
                          const favorite = favoriteSet.has(favoriteKey(entry.group.id, model.id))
                          return (
                            <div key={model.id} className="dsh-proto-row">
                              <button
                                type="button"
                                role="menuitemradio"
                                className="dsh-proto-model"
                                data-selected={selected}
                                aria-checked={selected}
                                disabled={busy}
                                onClick={() => choose({ provider: entry.group.id, model: model.id })}
                              >
                                <span className="dsh-proto-model-name">{model.name}</span>
                                <span className="dsh-proto-check">{pending ? '…' : selected ? '✓' : ''}</span>
                              </button>
                              <button
                                type="button"
                                className="dsh-proto-star"
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
                      <div className="dsh-proto-hint">
                        {tab === FAVORITES_TAB
                          ? '还没有收藏的模型。'
                          : query.trim().length > 0 ? '没有匹配的模型。' : state.status === 'loading' ? '' : '暂无可用模型。'}
                      </div>
                    )}
                  </>
                )}
                {error !== null && <div className="dsh-proto-error">{error}</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  )
}
