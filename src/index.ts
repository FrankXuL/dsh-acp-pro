import { PLUGIN_ID } from './shared/constants.ts'

export const name = PLUGIN_ID

export const inject = ['llm']

export { apply } from './host/apply.ts'
export { Config } from './host/config/schema.ts'
export type { AcpAgentProfile, AcpModelProfile, PermissionPolicy, SystemPromptMode } from './shared/types.ts'
export { AcpAdapter } from './host/service/acp-adapter.ts'
