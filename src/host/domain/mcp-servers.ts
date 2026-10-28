/**
 * MCP servers configured for this host, translated into the `mcpServers` an ACP
 * `session/new` request carries.
 *
 * DSH has no service that lists MCP servers: `@deepseek-ai/dsh-mcp-client` is loaded once
 * per server entry and each instance owns only its own connection. The Loader entry tree is
 * therefore the enumerable source. A running entry's validated `fiber.config` already holds
 * the schema defaults and the `!!js` interpolation, so this module reads resolved configs
 * and never parses `cordis.yml` itself.
 */

import type { EnvVariable, HttpHeader, McpServer } from '@agentclientprotocol/sdk'
import type { HostLogger } from '../types/index.ts'
import { PLUGIN_ID } from '../../shared/constants.ts'

/** A Loader entry as this module reads it. */
export interface McpLoaderEntry {
  /** True when this entry or an owning group is disabled. */
  readonly disabled: boolean
  /** Absent until the entry starts; `config` is the schema-validated plugin config. */
  readonly fiber: { readonly config: unknown } | undefined
}

/** The Loader service surface MCP enumeration needs. */
export interface McpLoader {
  /** Every entry in the tree, nested groups included. */
  entries: () => Iterable<McpLoaderEntry>
}

/** One ACP server plus the parts of the DSH config that ACP cannot carry. */
export interface AcpMcpServerMapping {
  server: McpServer
  /** Degradations worth logging once per resolution. */
  warnings: readonly string[]
}

/**
 * One entry's mapping: an ACP server, or the reason an MCP client config cannot be carried.
 * `undefined` means the config is not an MCP client config at all.
 */
export type AcpMcpServerOutcome = AcpMcpServerMapping | { skipped: string }

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** ACP carries environment variables as name/value pairs, DSH as a record. */
function envVariables(env: Readonly<Record<string, string>>): EnvVariable[] {
  return Object.entries(env).map(([name, value]) => ({ name, value }))
}

/** ACP carries HTTP headers as name/value pairs, DSH as a record. */
function httpHeaders(headers: Readonly<Record<string, string>>): HttpHeader[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }))
}

/**
 * Map one running entry's config onto an ACP server.
 *
 * DSH-only settings (tool-call timeout, reconnect policy, `failOnStartupError`, instruction
 * budget) are left behind: ACP describes a server, not a client's connection policy. A stdio
 * entry's `cwd` has no ACP counterpart either, so it is dropped with a warning.
 *
 * @param config - one `dsh-mcp-client` entry's validated config.
 * @returns the mapped server with its warnings, a skip reason for an MCP client config ACP
 *   cannot represent, or `undefined` when the config is not an MCP client config.
 */
export function acpMcpServerOf(config: unknown): AcpMcpServerOutcome | undefined {
  if (typeof config !== 'object' || config === null || Array.isArray(config))
    return undefined
  const record = config as Readonly<Record<string, unknown>>
  const name = record.serverName
  if (typeof name !== 'string' || name.length === 0)
    return undefined
  const transport = record.transport
  if (transport === 'stdio') {
    const command = record.command
    if (typeof command !== 'string' || command.length === 0)
      return { skipped: `MCP server "${name}" has no command` }
    const warnings: string[] = []
    const cwd = record.cwd
    if (typeof cwd === 'string' && cwd.length > 0)
      warnings.push(`ACP sessions cannot forward the working directory of MCP server "${name}"; the agent starts "${command}" from its own cwd`)
    const server: McpServer = { name, command, args: stringArray(record.args), env: envVariables(stringRecord(record.env)) }
    return { server, warnings }
  }
  if (transport === 'streamable-http' || transport === 'sse') {
    const url = record.url
    if (typeof url !== 'string' || url.length === 0)
      return { skipped: `MCP server "${name}" has no url` }
    // `dsh-mcp-client` itself only speaks Streamable HTTP; a legacy `sse` entry from another
    // MCP client plugin is offered as the same URL-based ACP transport.
    const server: McpServer = { type: 'http', name, url, headers: httpHeaders(stringRecord(record.headers)) }
    return { server, warnings: [] }
  }
  return { skipped: `MCP server "${name}" uses unsupported transport ${JSON.stringify(transport)}` }
}

/**
 * Collect every running MCP client entry as an ACP server.
 *
 * ACP accepts one flat server list, so a `serverName` configured twice keeps its first
 * entry. Entries that are disabled, not MCP client configs, or unmappable are skipped;
 * skipped and degraded entries are logged once per resolution.
 *
 * @param loader - the Loader service, or `undefined` when the host has none.
 * @param logger - host log for skipped and degraded entries.
 * @returns the servers one `session/new` may forward, in Loader entry order.
 */
export function collectAcpMcpServers(loader: McpLoader | undefined, logger: HostLogger): McpServer[] {
  if (loader === undefined)
    return []
  const servers: McpServer[] = []
  const names = new Set<string>()
  for (const entry of loader.entries()) {
    if (entry.disabled)
      continue
    const outcome = acpMcpServerOf(entry.fiber?.config)
    if (outcome === undefined)
      continue
    if ('skipped' in outcome) {
      logger.warn(`${PLUGIN_ID}: MCP server not forwarded: ${outcome.skipped}`)
      continue
    }
    const name = outcome.server.name
    if (names.has(name)) {
      logger.warn(`${PLUGIN_ID}: MCP server "${name}" is configured more than once; forwarding the first entry only`)
      continue
    }
    for (const warning of outcome.warnings)
      logger.warn(`${PLUGIN_ID}: ${warning}`)
    names.add(name)
    servers.push(outcome.server)
  }
  return servers
}

/**
 * Resolves the servers every ACP session may forward. Installed once by the plugin apply;
 * the ACP process is created inside the adapter, so injection goes through this module
 * rather than through a constructor argument owned by another module.
 */
let source: (() => readonly McpServer[]) | undefined

/**
 * Install the resolver `session/new` reads its `mcpServers` from.
 *
 * @param next - resolver for the current forward set, or `undefined` to stop forwarding and
 *   restore the pre-forwarding behavior.
 */
export function installMcpServerSource(next: (() => readonly McpServer[]) | undefined): void {
  source = next
}

/** The MCP servers this host forwards; empty when nothing is installed. */
export function installedMcpServers(): readonly McpServer[] {
  return source?.() ?? []
}
