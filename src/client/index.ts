import type { AcpClientContext } from './types/runtime.ts'
import { PLUGIN_ID } from '../shared/constants.ts'
import { AcpPermissionNode, AcpPlanNode, AcpToolCallNode } from './components/record-nodes.tsx'
import { acpPermissionDefinition, acpPlanDefinition, acpToolCallDefinition } from './conversation/records.ts'
import { acpTrajectoryToolCallDefinition } from './conversation/trajectory-records.ts'
import { en, NS, zh } from './locales/index.ts'
import { registerAgentsSection } from './register/agents-section.ts'
import { registerModelSeat } from './register/model-seat.ts'
import { mountSessionControlRemote } from './register/session-control-remote.ts'
import { registerSessionControlStyles } from './register/session-control-styles.ts'
import { registerStyles } from './register/styles.ts'

export const name = PLUGIN_ID

export const inject = ['slots', 'locale', 'remote', 'remote.llm', 'configForms', 'uiConversation']

export function apply(ctx: AcpClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${PLUGIN_ID}: locale dictionaries`)
  ctx.effect(registerStyles, `${PLUGIN_ID}: page styles`)
  ctx.effect(registerSessionControlStyles, `${PLUGIN_ID}: session control styles`)
  ctx.effect(() => registerAgentsSection(ctx), `${PLUGIN_ID}: agents settings section`)
  ctx.effect(() => registerModelSeat(ctx), `${PLUGIN_ID}: model seat`)
  ctx.effect(() => mountSessionControlRemote(ctx), `${PLUGIN_ID}: ACP session controls`)
  ctx.effect(() => {
    const undo = [
      // Chat cards: tool calls, plans, permission requests.
      ctx.uiConversation.events.register(acpToolCallDefinition),
      ctx.uiConversation.events.register(acpPlanDefinition),
      ctx.uiConversation.events.register(acpPermissionDefinition),
      // Trajectory rows: the same tool-call records, for the native stage view. Plans and
      // permissions stay in Chat — the Trajectory target has no shape for them, and faking one
      // would disguise a plan as a tool result.
      ctx.uiConversation.events.register(acpTrajectoryToolCallDefinition),
    ]
    return () => {
      for (const dispose of undo) dispose()
    }
  }, `${PLUGIN_ID}: ACP execution Definitions`)
  ctx.slots.inject('conversation.chat.node', function* () {
    yield ctx.slots.register({ name: 'conversation.chat.node', key: 'acp-tool-call', locale: NS }, AcpToolCallNode)
    yield ctx.slots.register({ name: 'conversation.chat.node', key: 'acp-plan', locale: NS }, AcpPlanNode)
    yield ctx.slots.register({ name: 'conversation.chat.node', key: 'acp-permission', locale: NS }, AcpPermissionNode)
  })
}
