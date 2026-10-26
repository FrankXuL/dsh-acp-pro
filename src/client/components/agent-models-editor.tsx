import type { ReactElement } from 'react'
import type { AcpModelProfile } from '../../shared/types.ts'
import type { Translate } from '../locales/index.ts'
import { Button, IconPlusOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

export interface AgentModelsEditorProps {
  t: Translate
  models: readonly AcpModelProfile[]
  /** Whether the route is saved; discovery starts the saved agent. */
  saved: boolean
  disabled: boolean
  discovering: boolean
  onChange: (models: AcpModelProfile[]) => void
  onDiscover: () => void
}

/** Declared-model rows plus the add / discover actions. */
export function AgentModelsEditor(props: AgentModelsEditorProps): ReactElement {
  const { t, models, saved, disabled, discovering, onChange, onDiscover } = props
  const update = (index: number, patch: Partial<AcpModelProfile>): void => {
    onChange(models.map((model, at) => at === index ? { ...model, ...patch } : model))
  }
  return (
    <div className="dta-models">
      {models.map((model, index) => (
        // Rows have no stable identity while their id is being typed; position is the identity.
        <div key={index} className="dta-model">
          <input
            className="dta-input"
            aria-label={t('modelId')}
            placeholder={t('modelId')}
            value={model.id}
            disabled={disabled}
            onChange={event => update(index, { id: event.target.value })}
          />
          <input
            className="dta-input"
            aria-label={t('modelName')}
            placeholder={t('modelName')}
            value={model.name ?? ''}
            disabled={disabled}
            onChange={event => update(index, { name: event.target.value })}
          />
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(models.filter((_, at) => at !== index))}>
            {t('removeModel')}
          </Button>
        </div>
      ))}
      <div className="dta-actions">
        <Button
          variant="outline"
          size="sm"
          icon={<IconPlusOutlineRegular size={14} />}
          disabled={disabled}
          onClick={() => onChange([...models, { id: '' }])}
        >
          {t('addModel')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          icon={<IconRefreshOutlineRegular size={14} />}
          disabled={disabled || discovering || !saved}
          onClick={onDiscover}
        >
          {t(discovering ? 'discovering' : 'discover')}
        </Button>
      </div>
      <span className="dta-hint">{t(saved ? 'discoverStale' : 'discoverNeedsSave')}</span>
    </div>
  )
}
