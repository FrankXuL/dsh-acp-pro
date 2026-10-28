/**
 * The picker's model list: search box, grouped rows, favorite stars, and the empty states.
 *
 * Presentation only. Selection and favorites arrive as callbacks so this file never decides
 * what may be chosen — that lives in `service/selection.ts`.
 */

import type { ReactElement } from 'react'
import type { ModelInfo, ModelSelection } from '../../types/runtime.ts'
import type { VisibleGroup } from '../../service/selection.ts'
import { FAVORITES_TAB } from '../../service/selection.ts'
import { favoriteKey } from '../../service/favorites.ts'

export interface ModelListProps {
  readonly tab: string
  readonly query: string
  readonly showSearch: boolean
  readonly busy: boolean
  readonly loading: boolean
  readonly error: string | null
  readonly failure: { readonly name: string, readonly message: string } | undefined
  readonly groups: readonly VisibleGroup[]
  readonly current: ModelSelection | null
  /** The selection submitted but not yet confirmed, if any. */
  readonly pending: { readonly provider: string, readonly model: string } | null
  readonly favoriteSet: ReadonlySet<string>
  readonly onQuery: (value: string) => void
  readonly onChoose: (selection: ModelSelection) => void
  readonly onToggleFavorite: (provider: string, model: string) => void
}

/** One row: the model button plus its favorite star. */
function ModelRow({
  groupId,
  model,
  selected,
  pending,
  favorite,
  busy,
  onChoose,
  onToggleFavorite,
}: {
  readonly groupId: string
  readonly model: ModelInfo
  readonly selected: boolean
  readonly pending: boolean
  readonly favorite: boolean
  readonly busy: boolean
  readonly onChoose: (selection: ModelSelection) => void
  readonly onToggleFavorite: (provider: string, model: string) => void
}): ReactElement {
  return (
    <div key={model.id} className="dsh-model-seat-row">
      <button
        type="button"
        role="menuitemradio"
        className="dsh-model-seat-model"
        data-selected={selected}
        aria-checked={selected}
        disabled={busy}
        onClick={() => onChoose({ provider: groupId, model: model.id })}
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
        onClick={() => onToggleFavorite(groupId, model.id)}
      >
        {favorite ? '★' : '☆'}
      </button>
    </div>
  )
}

/** Empty-state copy for the active tab. */
function emptyHint(tab: string, query: string, loading: boolean): string {
  if (tab === FAVORITES_TAB)
    return '还没有收藏的模型。'
  if (query.trim().length > 0)
    return '没有匹配的模型。'
  return loading ? '' : '暂无可用模型。'
}

/** The scrollable model list for one tab. */
export function ModelList(props: ModelListProps): ReactElement {
  const { groups, current, pending, favoriteSet, busy } = props
  return (
    <>
      {props.showSearch && (
        <input
          className="dsh-model-seat-search"
          value={props.query}
          placeholder="搜索当前来源"
          onChange={event => props.onQuery(event.target.value)}
        />
      )}
      <div className="dsh-model-seat-list">
        {props.loading && <div className="dsh-model-seat-hint">加载中…</div>}
        {props.failure !== undefined && (
          <div className="dsh-model-seat-error">{props.failure.name}：{props.failure.message}</div>
        )}
        {groups.map(entry => (
          <div key={entry.group.id}>
            {groups.length > 1 && <div className="dsh-model-seat-group">{entry.group.name}</div>}
            {entry.models.map((model: ModelInfo) => {
              const selected = current !== null && current.provider === entry.group.id && current.model === model.id
              const isPending = pending !== null && pending.provider === entry.group.id && pending.model === model.id
              return (
                <ModelRow
                  key={model.id}
                  groupId={entry.group.id}
                  model={model}
                  selected={selected}
                  pending={isPending}
                  favorite={favoriteSet.has(favoriteKey(entry.group.id, model.id))}
                  busy={busy}
                  onChoose={props.onChoose}
                  onToggleFavorite={props.onToggleFavorite}
                />
              )
            })}
          </div>
        ))}
        {groups.length === 0 && (
          <div className="dsh-model-seat-hint">{emptyHint(props.tab, props.query, props.loading)}</div>
        )}
        {props.error !== null && <div className="dsh-model-seat-error">{props.error}</div>}
      </div>
    </>
  )
}
