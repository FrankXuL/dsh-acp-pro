import type { AcpClientContext } from '../types/runtime.ts'
import type { AcpSessionControlClient } from '../../shared/session-control-remote.ts'
import { SessionControlPanel } from '../components/session-control-panel.tsx'
import { NS, translator } from '../locales/index.ts'

export function registerSessionControlPanel(ctx: AcpClientContext, control: AcpSessionControlClient): () => void {
  const t = translator(ctx.locale)
  return ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'acp-session-control',
    order: 15,
    locale: NS,
    inject: () => ({ control, t }),
  }, SessionControlPanel))
}
