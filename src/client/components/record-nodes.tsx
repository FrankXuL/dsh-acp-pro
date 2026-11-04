/** Keyed Chat renderers for ACP tool calls, plans and permission requests recorded by the Host. */

import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AcpPlanViewData, AcpPermissionViewData, AcpToolCallViewData } from '../conversation/records.ts'
import { lineDiff } from '../lib/line-diff.ts'
import { isSkippedMcpStartup } from '../lib/mcp-startup-notice.ts'

/** Full props of the ACP tool-call row. */
export type AcpToolCallNodeProps =
  PropsRuntime<'conversation.chat.node', 'acp-tool-call'> & PropsLocale<'dshAcpPro'>

/** Full props of the ACP plan card. */
export type AcpPlanNodeProps =
  PropsRuntime<'conversation.chat.node', 'acp-plan'> & PropsLocale<'dshAcpPro'>

/** One answer a future interactive permission card would settle the request with. */
export interface AcpPermissionAnswer {
  readonly requestId: string
  readonly optionId: string
}

/** Settles a pending ACP permission request with the chosen option. */
export type AcpPermissionAnswerHandler = (answer: AcpPermissionAnswer) => void | Promise<void>

/**
 * Injected answering face the interactive card will receive from its slot registration's
 * `inject`. The display-only version never calls it: the Host answers through DSH's native
 * approval dialog, so no card button can race that dialog.
 */
export interface AcpPermissionInjected {
  readonly answer: AcpPermissionAnswerHandler
}

/**
 * Full props of the ACP permission card. The injected `answer` face fixes the boundary the
 * clickable version will build on; the renderer only reads `node` and `t` today.
 */
export type AcpPermissionNodeProps =
  PropsRuntime<'conversation.chat.node', 'acp-permission'> & PropsLocale<'dshAcpPro'> & InjectFace<AcpPermissionInjected>

type Translate = AcpToolCallNodeProps['t']
type OpenFile = AcpToolCallNodeProps['openFile']

const KIND_GLYPH: Readonly<Record<string, string>> = {
  read: 'R',
  edit: 'E',
  delete: 'D',
  move: 'M',
  search: 'S',
  execute: '$',
  think: '?',
  fetch: '↓',
  switch_mode: '⇄',
  other: '·',
}

function glyphOf(kind: string | null): string {
  return kind === null ? '·' : KIND_GLYPH[kind] ?? '·'
}

function statusLabel(t: Translate, status: AcpToolCallViewData['status'] | 'skipped'): string {
  switch (status) {
    case 'pending': return t('status.pending')
    case 'in_progress': return t('status.in_progress')
    case 'completed': return t('status.completed')
    case 'failed': return t('status.failed')
    case 'skipped': return t('status.skipped')
    /* v8 ignore next -- AcpToolStatus is closed and every variant is handled above. */
    default: return status
  }
}

function durationLabel(t: Translate, data: AcpToolCallViewData): string | undefined {
  if (data.status === 'pending' || data.status === 'in_progress')
    return undefined
  const seconds = Math.max(0, Math.round((data.updatedAt - data.startedAt) / 1000))
  return t('tool.duration', { duration: seconds < 1 ? '<1s' : seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s` })
}

function locationLabel(location: AcpToolCallViewData['locations'][number]): string {
  return location.line === undefined ? location.path : `${location.path}:${location.line}`
}

function inputPreview(input: string | null): { text: string, truncated: boolean } | undefined {
  if (input === null || input.length === 0)
    return undefined
  const text = input.replace(/\s+/g, ' ').trim()
  return {
    text: text.slice(0, 160),
    truncated: text.length > 160 || /… \(\d+ chars omitted\)$/.test(text),
  }
}

function DiffBlock({ path, oldText, newText, t, openFile }: {
  path: string
  oldText: string | null
  newText: string
  t: Translate
  openFile: OpenFile
}): ReactElement {
  const lines = useMemo(() => lineDiff(oldText ?? '', newText), [oldText, newText])
  return (
    <div className="dap-diff-block">
      <button type="button" className="dap-file-path" onClick={() => { void openFile(path) }} title={path}>
        {path}
      </button>
      {lines === null
        ? (
            <div className="dap-diff-fallback">
              {oldText !== null && oldText.length > 0
                ? <pre className="dap-pre dap-diff-old">{oldText}</pre>
                : null}
              <pre className="dap-pre dap-diff-new">{newText}</pre>
              <div className="dap-hint">{t('tool.diffTooLarge')}</div>
            </div>
          )
        : (
            <pre className="dap-diff">{lines.map((line, index) => (
              <span key={index} className={`dap-line dap-line-${line.kind}`}>
                {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
                {line.text}
                {'\n'}
              </span>
            ))}</pre>
          )}
    </div>
  )
}

function ContentBlock({ block, t, openFile }: {
  block: AcpToolCallViewData['content'][number]
  t: Translate
  openFile: OpenFile
}): ReactElement {
  switch (block.type) {
    case 'text':
      return <pre className="dap-pre">{block.text}</pre>
    case 'diff':
      return <DiffBlock path={block.path} oldText={block.oldText} newText={block.newText} t={t} openFile={openFile} />
    case 'terminal':
      return <div className="dap-hint">{t('tool.terminal', { id: block.terminalId })}</div>
    case 'link':
      return <div className="dap-hint">{t('tool.link', { name: block.name, uri: block.uri })}</div>
    case 'image':
      return <div className="dap-hint">{t('tool.image', { mediaType: block.mediaType, bytes: block.bytes })}</div>
    /* v8 ignore next -- AcpToolContentView is closed and every variant is handled above. */
    default:
      return <div className="dap-hint">{t('tool.noDetail')}</div>
  }
}

/** One ACP tool call as a compact activity row with an expandable body. */
export function AcpToolCallNode({ node, t, openFile }: AcpToolCallNodeProps): ReactElement {
  const [open, setOpen] = useState(false)
  const data = node.data
  // Older saved snapshots predate the detail fields, so keep them renderable.
  const content = data.content ?? []
  const locations = data.locations ?? []
  const input = data.input ?? null
  const output = data.output ?? null
  const preview = inputPreview(input)
  const duration = durationLabel(t, data)
  // A by-name MCP skip reaches us through the failure channel but is not a failure.
  const status = isSkippedMcpStartup(data) ? 'skipped' as const : data.status
  const hasBody = content.length > 0 || locations.length > 0 || input !== null || output !== null
  return (
    <div className="dap-rec" data-status={status}>
      <button
        type="button"
        className="dap-rec-head"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className="dap-rec-glyph" aria-hidden="true">{glyphOf(data.kind)}</span>
        <span className="dap-rec-title">{data.title}</span>
        {locations[0] === undefined ? null : (
          <span className={`dap-rec-summary${preview === undefined ? '' : ' dap-rec-summary-with-preview'}`}>
            {locationLabel(locations[0])}
          </span>
        )}
        {preview === undefined ? null : (
          <span className="dap-rec-input-preview" title={input ?? undefined}>
            <span className="dap-rec-input-preview-text">{preview.text}</span>
            {preview.truncated ? <span className="dap-rec-preview-truncated">{t('tool.previewTruncated')}</span> : null}
          </span>
        )}
        <span className="dap-rec-meta">
          {duration === undefined ? null : <span className="dap-rec-duration">{duration}</span>}
          <span
            className="dap-rec-status"
            role={status === 'failed' ? 'alert' : status === 'pending' || status === 'in_progress' ? 'status' : undefined}
            aria-live={status === 'failed' ? 'assertive' : status === 'pending' || status === 'in_progress' ? 'polite' : undefined}
          >
            {statusLabel(t, status)}
          </span>
          <span className="dap-rec-dot" aria-hidden="true" />
        </span>
      </button>
      {open
        ? (
            <div className="dap-rec-body">
              {!hasBody ? <div className="dap-hint">{t('tool.noDetail')}</div> : null}
              {locations.length === 0 ? null : (
                <div className="dap-field">
                  <div className="dap-field-label">{t('tool.locations')}</div>
                  <div className="dap-rec-locations">
                    {locations.map((location, index) => (
                      <button
                        key={`${location.path}:${location.line ?? ''}:${index}`}
                        type="button"
                        className="dap-file-path dap-rec-location"
                        data-location-index={index}
                        onClick={() => {
                          if (location.line === undefined)
                            void openFile(location.path)
                          else
                            void openFile(location.path, { line: location.line })
                        }}
                        title={locationLabel(location)}
                      >
                        {locationLabel(location)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {content.map((block, index) => <ContentBlock key={index} block={block} t={t} openFile={openFile} />)}
              {input === null ? null : (
                <div className="dap-field">
                  <div className="dap-field-label">{t('tool.input')}</div>
                  <pre className="dap-pre">{input}</pre>
                </div>
              )}
              {output === null ? null : (
                <div className="dap-field">
                  <div className="dap-field-label">{t('tool.output')}</div>
                  <pre className="dap-pre">{output}</pre>
                </div>
              )}
            </div>
          )
        : null}
    </div>
  )
}

function planMark(status: string): string {
  switch (status) {
    case 'completed': return '✓'
    case 'in_progress': return '●'
    case 'cancelled': return '×'
    default: return '○'
  }
}

/** One ACP plan as a checklist card. */
export function AcpPlanNode({ node, t }: AcpPlanNodeProps): ReactElement {
  const data: AcpPlanViewData = node.data
  const done = data.entries.filter(entry => entry.status === 'completed').length
  return (
    <div className="dap-plan">
      <div className="dap-plan-head">
        <span className="dap-plan-title">{t('plan.title')}</span>
        <span className="dap-plan-count">{t('plan.count', { done, total: data.entries.length })}</span>
      </div>
      {data.entries.length === 0
        ? <div className="dap-hint">{t('plan.empty')}</div>
        : (
            <ul className="dap-plan-list">
              {data.entries.map((entry, index) => (
                <li key={index} className="dap-plan-item" data-status={entry.status}>
                  <span className="dap-plan-mark" aria-hidden="true">{planMark(entry.status)}</span>
                  <span className="dap-plan-text">{entry.content}</span>
                </li>
              ))}
            </ul>
          )}
    </div>
  )
}

type PermissionStatus = AcpPermissionViewData['status']
type PermissionOptionKind = AcpPermissionViewData['options'][number]['kind']

function permissionGlyph(status: PermissionStatus): string {
  switch (status) {
    case 'pending': return '?'
    case 'allowed': return '✓'
    case 'rejected': return '×'
    case 'cancelled': return '–'
    /* v8 ignore next -- AcpPermissionStatus is closed; the fallback keeps the switch total. */
    default: return '·'
  }
}

function permissionStatusLabel(t: Translate, status: PermissionStatus): string {
  switch (status) {
    case 'pending': return t('permission.status.pending')
    case 'allowed': return t('permission.status.allowed')
    case 'rejected': return t('permission.status.rejected')
    case 'cancelled': return t('permission.status.cancelled')
    /* v8 ignore next -- AcpPermissionStatus is closed and every variant is handled above. */
    default: return status
  }
}

function permissionOptionKindLabel(t: Translate, kind: PermissionOptionKind): string {
  switch (kind) {
    case 'allow_once': return t('permission.option.allow_once')
    case 'allow_always': return t('permission.option.allow_always')
    case 'reject_once': return t('permission.option.reject_once')
    case 'reject_always': return t('permission.option.reject_always')
    /* v8 ignore next -- option kinds come from the closed ACP schema. */
    default: return kind
  }
}

/**
 * One ACP permission request as a status card. Display-only on purpose: the answer is
 * still collected by the native DSH approval dialog, so the offered options are shown
 * as plain rows and no card button can race that dialog.
 */
export function AcpPermissionNode({ node, t }: AcpPermissionNodeProps): ReactElement {
  const data: AcpPermissionViewData = node.data
  return (
    <div className="dap-permission" data-status={data.status} role="group" aria-label={t('permission.title')}>
      <div className="dap-permission-head">
        <span className="dap-permission-glyph" aria-hidden="true">{permissionGlyph(data.status)}</span>
        <span className="dap-permission-title">
          {data.title.trim() === '' ? t('permission.title') : data.title}
        </span>
        {data.kind === null
          ? null
          : <span className="dap-permission-kind">{t('permission.kind', { kind: data.kind })}</span>}
        <span className="dap-permission-status">{permissionStatusLabel(t, data.status)}</span>
      </div>
      {data.options.length === 0
        ? <div className="dap-permission-empty">{t('permission.emptyOptions')}</div>
        : (
            <ul className="dap-permission-options">
              {data.options.map((option, index) => (
                <li key={index} className="dap-permission-option" data-kind={option.kind}>
                  <span className="dap-permission-option-kind">{permissionOptionKindLabel(t, option.kind)}</span>
                  <span className="dap-permission-option-label">{option.label}</span>
                </li>
              ))}
            </ul>
          )}
      {data.status === 'pending' ? <div className="dap-permission-hint">{t('permission.displayOnly')}</div> : null}
    </div>
  )
}
