/**
 * codex-acp reports a by-name MCP skip through the same failed-tool channel it uses for real
 * startup failures, so a server it deliberately did not start renders as an error row. The notice
 * text is the only signal separating the two: real failures and cancellations are prefixed
 * `[codex-acp forwarded startup error]`, a skip says the server "was not started".
 */

import type { AcpToolCallViewData } from '../conversation/records.ts'

const SKIP_NOTICE = 'was not started, because the Codex config already defines an MCP server with this name'

/** True when the row is an MCP startup skip notice, not an MCP startup failure. */
export function isSkippedMcpStartup(data: AcpToolCallViewData): boolean {
  if (data.status !== 'failed' || data.kind !== 'other' || !/^mcp__.+__startup$/.test(data.title)) return false
  // ponytail: matches upstream wording; a reworded notice falls back to the honest failure row.
  return data.content.some(block => block.type === 'text' && block.text.includes(SKIP_NOTICE))
}
