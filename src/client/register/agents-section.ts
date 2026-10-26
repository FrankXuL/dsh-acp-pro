import type { AgentsSectionProps } from '../components/agents-section.tsx'
import type { AcpClientContext } from '../types/runtime.ts'
import { PLUGIN_ID } from '../../shared/constants.ts'
import { AgentsSection } from '../components/agents-section.tsx'
import { NS, translator } from '../locales/index.ts'
import { registerModelsHint } from './models-hint.ts'

/**
 * Settings namespace = the profile entry id `cordis.patch.yml` inserts (0.2 cores key
 * every plugin form by entry id).
 */
const ENTRY = PLUGIN_ID

const SECTION_ID = 'acp-agents'

/** Right after the official Models page. */
const SECTION_ORDER = 11

/** settings.section page that edits the ACP agents section, mounted while the Host serves it. */
export function registerAgentsSection(ctx: AcpClientContext): () => void {
  const t = translator(ctx.locale)
  const props: AgentsSectionProps = { form: ctx.configForms.get(ENTRY), llm: ctx.remote.llm, t }
  return ctx.configForms.whileServed([ENTRY], () => {
    const disposers = [
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: SECTION_ID,
        order: SECTION_ORDER,
        locale: NS,
        label: () => t('nav'),
        inject: () => props,
      }, AgentsSection)),
      // The official Models page lists ACP routes under this entry's namespace; its generic
      // editor cannot edit them, so its hint points here instead.
      registerModelsHint(ENTRY, t),
    ]
    return () => {
      for (const dispose of disposers)
        dispose()
    }
  })
}
