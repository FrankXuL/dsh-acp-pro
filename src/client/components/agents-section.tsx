import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.ts'
import type { AgentDraft, AgentImportEntry, AgentRow } from '../service/agents.types.ts'
import type { ConfigForm, LlmRemote } from '../types/runtime.ts'
import { Button, IconEditOutlineRegular, IconPlusOutlineRegular, IconTrashOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { discoverAgentModels, importAgents, removeAgent, saveAgent } from '../service/agents.ts'
import { draftOf, emptyDraft, mergeDiscovered, snapshotOf, validateDraft } from '../service/agents.utils.ts'
import { AgentEditorForm } from './agent-editor-form.tsx'
import { AgentImportView } from './agent-import-view.tsx'

export interface AgentsSectionProps {
  form: ConfigForm
  llm: LlmRemote
  t: Translate
}

export type Message = { tone: 'ok' | 'error', text: string } | null

function commandLine(row: AgentRow): string {
  return [row.profile.command, ...row.profile.args].join(' ')
}

/** settings.section page: list, add, edit and remove ACP agents. */
export function AgentsSection({ form, llm, t }: AgentsSectionProps): ReactElement {
  // ConfigForm methods read their own `this`; never hand them to React unbound.
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const agents = useMemo(() => snapshotOf(snapshot), [snapshot])
  const { rows } = agents
  const writable = snapshot.status === 'ready' && agents.writable
  const [draft, setDraft] = useState<AgentDraft | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)
  const [formMessage, setFormMessage] = useState<Message>(null)
  const [listMessage, setListMessage] = useState<Message>(null)

  function open(next: AgentDraft): void {
    setDraft(next)
    setFormMessage(null)
    setListMessage(null)
    setPendingRemoval(null)
  }

  async function save(current: AgentDraft): Promise<void> {
    const validation = validateDraft(current, rows)
    if (!validation.ok) {
      setFormMessage({ tone: 'error', text: t(validation.issue.key, validation.issue.params) })
      return
    }
    setBusy(true)
    const result = await saveAgent({ form, originalRoute: current.originalRoute, route: validation.route, profile: validation.profile })
    setBusy(false)
    if (result.ok) {
      setDraft(null)
      return
    }
    setFormMessage({ tone: 'error', text: result.error === undefined ? t('refused') : t('saveFailed', { message: result.error }) })
  }

  async function discover(current: AgentDraft, route: string): Promise<void> {
    setDiscovering(true)
    setFormMessage(null)
    const result = await discoverAgentModels({ llm, route })
    setDiscovering(false)
    if (!result.ok) {
      setFormMessage({ tone: 'error', text: t('discoverFailed', { message: result.error ?? '' }) })
      return
    }
    const found = result.models ?? []
    const added = mergeDiscovered(current.models, found).length - current.models.length
    setDraft(latest => latest === null ? latest : { ...latest, models: mergeDiscovered(latest.models, found) })
    setFormMessage({ tone: 'ok', text: added > 0 ? t('discovered', { count: added }) : t('discoverNone') })
  }

  async function runImport(entries: readonly AgentImportEntry[]): Promise<void> {
    setBusy(true)
    const result = await importAgents({ form, entries })
    setBusy(false)
    if (result.ok) {
      setImporting(false)
      setListMessage({ tone: 'ok', text: t('importDone', { count: entries.length }) })
      return
    }
    setFormMessage({ tone: 'error', text: result.error === undefined ? t('refused') : t('importFailed', { message: result.error }) })
  }

  async function remove(route: string): Promise<void> {
    if (pendingRemoval !== route) {
      setPendingRemoval(route)
      return
    }
    setBusy(true)
    const result = await removeAgent({ form, route })
    setBusy(false)
    setPendingRemoval(null)
    if (!result.ok)
      setListMessage({ tone: 'error', text: result.error === undefined ? t('refused') : t('removeFailed', { message: result.error }) })
  }

  if (importing) {
    return (
      <AgentImportView
        t={t}
        rows={rows}
        writable={writable}
        busy={busy}
        message={formMessage}
        onCancel={() => setImporting(false)}
        onImport={entries => void runImport(entries)}
      />
    )
  }

  if (draft !== null) {
    const row = rows.find(entry => entry.route === draft.originalRoute)
    return (
      <AgentEditorForm
        t={t}
        draft={draft}
        routeLocked={row?.inherited === true}
        writable={writable}
        busy={busy}
        discovering={discovering}
        message={formMessage}
        onChange={patch => setDraft(current => current === null ? current : { ...current, ...patch })}
        onDiscover={() => {
          if (draft.originalRoute !== null)
            void discover(draft, draft.originalRoute)
        }}
        onCancel={() => setDraft(null)}
        onSave={() => void save(draft)}
      />
    )
  }

  return (
    <div className="dta-root">
      <div className="dta-head">
        <div className="dta-head-text">
          <div className="dta-title">{t('nav')}</div>
          <div className="dta-hint">{t('description')}</div>
        </div>
        <div className="dta-actions">
          <Button
            variant="ghost"
            size="sm"
            disabled={!writable || busy}
            onClick={() => {
              setImporting(true)
              setFormMessage(null)
              setListMessage(null)
              setPendingRemoval(null)
            }}
          >
            {t('import')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<IconPlusOutlineRegular size={14} />}
            disabled={!writable || busy}
            onClick={() => open(emptyDraft())}
          >
            {t('add')}
          </Button>
        </div>
      </div>
      {snapshot.status === 'unavailable' && <div className="dta-banner" data-tone="error">{t('unavailable')}</div>}
      {snapshot.status === 'ready' && !agents.writable && <div className="dta-banner">{t('readonly')}</div>}
      {listMessage !== null && <div className="dta-banner" data-tone={listMessage.tone}>{listMessage.text}</div>}
      {snapshot.status === 'loading' && <div className="dta-empty">{t('loading')}</div>}
      {snapshot.status === 'ready' && rows.length === 0 && <div className="dta-empty">{t('empty')}</div>}
      {rows.map(row => (
        <div key={row.route} className="dta-row">
          <div className="dta-row-text">
            <div className="dta-name">
              <span className="dta-name-text">{row.profile.displayName ?? row.route}</span>
              <Tag tone="neutral">{row.route}</Tag>
              {row.inherited && <Tag>{t('inherited')}</Tag>}
              <Tag tone="quiet">
                {row.profile.models.length > 0 ? t('modelCount', { count: row.profile.models.length }) : t('modelsAuto')}
              </Tag>
            </div>
            <div className="dta-sub" title={commandLine(row)}>{commandLine(row)}</div>
          </div>
          <div className="dta-actions">
            <Button variant="ghost" size="sm" icon={<IconEditOutlineRegular size={14} />} disabled={busy} onClick={() => open(draftOf(row))}>
              {t('edit')}
            </Button>
            {!row.inherited && (
              <Button
                variant="ghost"
                size="sm"
                icon={<IconTrashOutlineRegular size={14} />}
                disabled={!writable || busy}
                onClick={() => void remove(row.route)}
              >
                {t(pendingRemoval === row.route ? 'confirmRemove' : 'remove')}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
