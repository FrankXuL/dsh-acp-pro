import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.ts'
import type { AgentImport, AgentImportEntry, AgentRow } from '../service/agents.types.ts'
import type { Message } from './agents-section.tsx'
import { Button, Checkbox, IconChevronLeftOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useState } from 'react'
import { parseAgentImport } from '../service/agent-import.utils.ts'

export interface AgentImportViewProps {
  t: Translate
  rows: readonly AgentRow[]
  writable: boolean
  busy: boolean
  message: Message
  onCancel: () => void
  onImport: (entries: readonly AgentImportEntry[]) => void
}

const PLACEHOLDER = `{
  "agent_servers": {
    "Claude": {
      "command": "npx",
      "args": ["-y", "@agentclientprotocol/claude-agent-acp"],
      "env": {}
    }
  }
}`

function commandLine(entry: AgentImportEntry): string {
  const args = Array.isArray(entry.profile.args) ? entry.profile.args : []
  return [entry.profile.command, ...args].join(' ')
}

/** Paste → preview → import flow for agent lists from other ACP clients. */
export function AgentImportView(props: AgentImportViewProps): ReactElement {
  const { t, rows, writable, busy, message, onCancel, onImport } = props
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<AgentImport | null>(null)
  /** Routes left out of the import; everything parsed starts selected. */
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
  const entries = parsed?.ok === true ? parsed.entries : []
  const selected = entries.filter(entry => !excluded.has(entry.route))
  const toggle = (route: string, include: boolean): void => {
    setExcluded((current) => {
      const next = new Set(current)
      if (include)
        next.delete(route)
      else
        next.add(route)
      return next
    })
  }
  return (
    <div className="dta-root">
      <div className="dta-back">
        <Button variant="ghost" size="sm" icon={<IconChevronLeftOutlineRegular size={14} />} disabled={busy} onClick={onCancel}>
          {t('back')}
        </Button>
        <div className="dta-title">{t('importTitle')}</div>
      </div>
      <label className="dta-field">
        <span className="dta-hint">{t('importHint')}</span>
        <textarea
          className="dta-textarea dta-textarea-tall"
          value={text}
          placeholder={PLACEHOLDER}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value)
            setParsed(null)
            setExcluded(new Set())
          }}
        />
      </label>
      <div className="dta-actions">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || text.trim().length === 0}
          onClick={() => {
            setParsed(parseAgentImport(text, rows))
            setExcluded(new Set())
          }}
        >
          {t('importParse')}
        </Button>
        {entries.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setExcluded(selected.length === entries.length ? new Set(entries.map(entry => entry.route)) : new Set())}
          >
            {t(selected.length === entries.length ? 'importSelectNone' : 'importSelectAll')}
          </Button>
        )}
      </div>
      {parsed?.ok === false && <div className="dta-banner" data-tone="error">{t('importInvalid', { message: parsed.error })}</div>}
      {parsed?.ok === true && entries.length === 0 && <div className="dta-banner" data-tone="error">{t('importNone')}</div>}
      {entries.map(entry => (
        <div key={entry.route} className="dta-row">
          <Checkbox
            checked={!excluded.has(entry.route)}
            label={t('importSelect', { name: entry.name })}
            disabled={busy}
            onChange={include => toggle(entry.route, include)}
          />
          <div className="dta-row-text">
            <div className="dta-name">
              <span className="dta-name-text">{entry.name}</span>
              <Tag tone="neutral">{entry.route}</Tag>
              <Tag tone={entry.replaces ? 'warning' : 'success'}>{t(entry.replaces ? 'importReplace' : 'importNew')}</Tag>
            </div>
            <div className="dta-sub" title={commandLine(entry)}>{commandLine(entry)}</div>
          </div>
        </div>
      ))}
      {parsed?.ok === true && parsed.skipped.map(issue => (
        <div key={issue.name} className="dta-hint">{t('importSkipped', { name: issue.name, reason: t(issue.reason) })}</div>
      ))}
      {message !== null && <div className="dta-banner" data-tone={message.tone}>{message.text}</div>}
      <div className="dta-footer">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>{t('cancel')}</Button>
        <Button variant="primary" disabled={!writable || busy || selected.length === 0} onClick={() => onImport(selected)}>
          {t(busy ? 'saving' : 'importApply', { count: selected.length })}
        </Button>
      </div>
    </div>
  )
}
