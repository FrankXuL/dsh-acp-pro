import type { ReactElement, ReactNode } from 'react'
import type { ImageInputMode, PermissionPolicy } from '../../shared/types.ts'
import type { Translate } from '../locales/index.ts'
import type { AgentDraft } from '../service/agents.types.ts'
import type { Message } from './agents-section.tsx'
import { Button, IconChevronLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { AgentModelsEditor } from './agent-models-editor.tsx'

export interface AgentEditorFormProps {
  t: Translate
  draft: AgentDraft
  /** Routes declared by the profile bundle keep their name: a rename could not remove that entry. */
  routeLocked: boolean
  writable: boolean
  busy: boolean
  discovering: boolean
  message: Message
  onChange: (patch: Partial<AgentDraft>) => void
  onDiscover: () => void
  onCancel: () => void
  onSave: () => void
}

const PERMISSIONS: readonly { value: PermissionPolicy, key: 'permissionAsk' | 'permissionAllow' | 'permissionReadOnly' | 'permissionReject' }[] = [
  { value: 'ask', key: 'permissionAsk' },
  { value: 'allow', key: 'permissionAllow' },
  { value: 'read-only', key: 'permissionReadOnly' },
  { value: 'reject', key: 'permissionReject' },
]

function isPermission(value: string): value is PermissionPolicy {
  return PERMISSIONS.some(option => option.value === value)
}

const IMAGE_INPUTS: readonly { value: ImageInputMode, key: 'imageInputAuto' | 'imageInputForce' | 'imageInputOff' }[] = [
  { value: 'auto', key: 'imageInputAuto' },
  { value: 'force', key: 'imageInputForce' },
  { value: 'off', key: 'imageInputOff' },
]

function isImageInput(value: string): value is ImageInputMode {
  return IMAGE_INPUTS.some(option => option.value === value)
}

function Field({ label, hint, children }: { label: string, hint?: string, children: ReactNode }): ReactElement {
  return (
    <label className="dta-field">
      <span className="dta-field-label">{label}</span>
      {children}
      {hint !== undefined && <span className="dta-hint">{hint}</span>}
    </label>
  )
}

/** Form for one ACP agent profile. */
export function AgentEditorForm(props: AgentEditorFormProps): ReactElement {
  const { t, draft, routeLocked, writable, busy, discovering, message, onChange, onDiscover, onCancel, onSave } = props
  const disabled = !writable || busy
  return (
    <div className="dta-root">
      <div className="dta-back">
        <Button variant="ghost" size="sm" icon={<IconChevronLeftOutlineRegular size={14} />} disabled={busy} onClick={onCancel}>
          {t('back')}
        </Button>
        <div className="dta-title">
          {draft.originalRoute === null ? t('createTitle') : t('editTitle', { route: draft.originalRoute })}
        </div>
      </div>
      <Field label={t('route')} hint={t(routeLocked ? 'inheritedHint' : 'routeHint')}>
        <input
          className="dta-input"
          value={draft.route}
          placeholder="codex"
          disabled={disabled || routeLocked}
          onChange={event => onChange({ route: event.target.value })}
        />
      </Field>
      <Field label={t('displayName')}>
        <input
          className="dta-input"
          value={draft.displayName}
          placeholder="Codex (ACP)"
          disabled={disabled}
          onChange={event => onChange({ displayName: event.target.value })}
        />
      </Field>
      <Field label={t('command')} hint={t('commandHint')}>
        <input
          className="dta-input"
          value={draft.command}
          placeholder="/usr/local/bin/codex-acp"
          disabled={disabled}
          onChange={event => onChange({ command: event.target.value })}
        />
      </Field>
      <Field label={t('args')} hint={t('argsHint')}>
        <textarea
          className="dta-textarea"
          value={draft.args}
          placeholder={'-y\n@agentclientprotocol/claude-agent-acp'}
          disabled={disabled}
          onChange={event => onChange({ args: event.target.value })}
        />
      </Field>
      <Field label={t('env')} hint={t('envHint')}>
        <textarea
          className="dta-textarea"
          value={draft.env}
          placeholder="OPENAI_API_KEY=sk-..."
          disabled={disabled}
          onChange={event => onChange({ env: event.target.value })}
        />
      </Field>
      <Field label={t('authMethod')} hint={t('authMethodHint')}>
        <input
          className="dta-input"
          value={draft.authMethod}
          placeholder="api-key"
          disabled={disabled}
          onChange={event => onChange({ authMethod: event.target.value })}
        />
      </Field>
      <Field label={t('permission')}>
        <select
          className="dta-input"
          value={draft.permission}
          disabled={disabled}
          onChange={(event) => {
            if (isPermission(event.target.value))
              onChange({ permission: event.target.value })
          }}
        >
          {PERMISSIONS.map(option => <option key={option.value} value={option.value}>{t(option.key)}</option>)}
        </select>
      </Field>
      <Field label={t('imageInput')} hint={t('imageInputHint')}>
        <select
          className="dta-input"
          value={draft.imageInput}
          disabled={disabled}
          onChange={(event) => {
            if (isImageInput(event.target.value))
              onChange({ imageInput: event.target.value })
          }}
        >
          {IMAGE_INPUTS.map(option => <option key={option.value} value={option.value}>{t(option.key)}</option>)}
        </select>
      </Field>
      <div className="dta-field">
        <span className="dta-field-label">{t('models')}</span>
        <span className="dta-hint">{t('modelsHint')}</span>
        <AgentModelsEditor
          t={t}
          models={draft.models}
          saved={draft.originalRoute !== null}
          disabled={disabled}
          discovering={discovering}
          onChange={models => onChange({ models })}
          onDiscover={onDiscover}
        />
      </div>
      {message !== null && <div className="dta-banner" data-tone={message.tone}>{message.text}</div>}
      <div className="dta-footer">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>{t('cancel')}</Button>
        <Button variant="primary" disabled={disabled} onClick={onSave}>{t(busy ? 'saving' : 'save')}</Button>
      </div>
    </div>
  )
}
