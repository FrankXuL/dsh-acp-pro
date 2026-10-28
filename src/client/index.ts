import type { AcpClientContext } from './types/runtime.ts'
import { PLUGIN_ID } from '../shared/constants.ts'
import { AcpPermissionNode, AcpPlanNode, AcpToolCallNode } from './components/record-nodes.tsx'
import { acpPermissionDefinition, acpPlanDefinition, acpToolCallDefinition } from './conversation/records.ts'
import { en, NS, zh } from './locales/index.ts'
import { registerAgentsSection } from './register/agents-section.ts'
import { registerModelSeatProto } from './register/model-seat-proto.ts'
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
  // PROTOTYPE (#04): shadow the composer model seat with a source-tab picker. Remove with #04.
  ctx.effect(() => registerModelSeatProto(ctx), `${PLUGIN_ID}: prototype model seat`)
  ctx.effect(() => mountSessionControlRemote(ctx), `${PLUGIN_ID}: ACP session controls`)
  ctx.effect(() => {
    const undo = [
      ctx.uiConversation.events.register(acpToolCallDefinition),
      ctx.uiConversation.events.register(acpPlanDefinition),
      ctx.uiConversation.events.register(acpPermissionDefinition),
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
