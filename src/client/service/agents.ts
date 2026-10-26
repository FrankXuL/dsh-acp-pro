import type { SettingsPathOpView } from '../types/runtime.ts'
import type {
  AgentActionResult,
  DiscoverAgentModelsInput,
  DiscoverAgentModelsResult,
  ImportAgentsInput,
  RemoveAgentInput,
  SaveAgentInput,
} from './agents.types.ts'
import { SETTINGS_NS } from '../../shared/constants.ts'
import { importOpsOf } from './agent-import.utils.ts'
import { removeOpsOf, saveOpsOf } from './agents.utils.ts'

/**
 * service/agents.ts — ACP agent settings.
 *
 * The plugin's settings form (`configForms.get(entryId)`) is the single source of truth:
 * writes are atomic path mutations fenced by the form's revision, and the form folds the
 * Host's answer back into the shared settings mirror. Model discovery asks the Host
 * plugin's registered discovery, which starts the saved agent and reads its models.
 */

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function write(form: SaveAgentInput['form'], ops: SettingsPathOpView[]): Promise<AgentActionResult> {
  try {
    return { ok: await form.mutate(ops) }
  }
  catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}

/** Action: store one agent profile, moving it when its route was renamed. */
export function saveAgent(input: SaveAgentInput): Promise<AgentActionResult> {
  return write(input.form, saveOpsOf(input.originalRoute, input.route, input.profile))
}

/** Action: delete one user-declared agent. */
export function removeAgent(input: RemoveAgentInput): Promise<AgentActionResult> {
  return write(input.form, removeOpsOf(input.route))
}

/** Action: store every agent of a parsed import in one write. */
export function importAgents(input: ImportAgentsInput): Promise<AgentActionResult> {
  return write(input.form, importOpsOf(input.entries))
}

/** Action: ask the saved agent which models it advertises. */
export async function discoverAgentModels(input: DiscoverAgentModelsInput): Promise<DiscoverAgentModelsResult> {
  try {
    const response = await input.llm.discoverModels(SETTINGS_NS, { provider: input.route })
    return response.ok ? { ok: true, models: response.value } : { ok: false, error: response.error.message }
  }
  catch (error) {
    return { ok: false, error: messageOf(error) }
  }
}
