import type { McpServer } from '@agentclientprotocol/sdk'
import type { HostLogger } from '../src/host/types/index.ts'
import type { AcpAgentProfile } from '../src/shared/types.ts'
import type { McpLoader, McpLoaderEntry } from '../src/host/service/mcp-servers.ts'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import { AcpAgentProcess } from '../src/host/service/acp-agent.ts'
import { collectAcpMcpServers, installedMcpServers, installMcpServerSource } from '../src/host/service/mcp-servers.ts'
import * as plugin from '../src/index.ts'

/** A `dsh-mcp-client` stdio entry after schema defaults. */
const STDIO = {
  transport: 'stdio',
  serverName: 'memory',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
  env: { MEMORY_FILE: '/tmp/memory.json' },
  cwd: '',
  toolCallTimeoutMs: 60_000,
  failOnStartupError: false,
}

/** A `dsh-mcp-client` Streamable HTTP entry after schema defaults. */
const HTTP = {
  transport: 'streamable-http',
  serverName: 'context7',
  url: 'https://mcp.context7.com/mcp',
  headers: { Authorization: 'Bearer test-token' },
  toolCallTimeoutMs: 60_000,
  failOnStartupError: false,
}

const quiet: HostLogger = { info: () => {}, warn: () => {}, error: () => {} }

function recordingLogger(): HostLogger & { warnings: string[] } {
  const warnings: string[] = []
  return {
    warnings,
    info: () => {},
    warn: (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '))
    },
    error: () => {},
  }
}

function entryOf(config: unknown, disabled = false): McpLoaderEntry {
  return { disabled, fiber: { config } }
}

function loaderOf(...entries: McpLoaderEntry[]): McpLoader {
  return { entries: () => entries }
}

function profileOf(overrides: Partial<AcpAgentProfile> = {}): AcpAgentProfile {
  return {
    command: 'mock-agent',
    args: [],
    env: {},
    models: [],
    discoverModels: false,
    permission: 'ask',
    imageInput: 'auto',
    systemPrompt: 'drop',
    showToolCalls: false,
    contextWindow: 200_000,
    startupTimeoutMs: 1_000,
    idleTimeoutMs: 1_000,
    ...overrides,
  }
}

/** A process whose `session/new` requests are observed instead of sent over a transport. */
function stubAgent(profile: AcpAgentProfile): { agent: AcpAgentProcess, requests: Array<{ method: string, params: unknown }> } {
  const requests: Array<{ method: string, params: unknown }> = []
  const agent = new AcpAgentProcess({
    route: 'mock',
    profile: () => profile,
    onPermission: () => Promise.reject(new Error('this test never asks for permission')),
    logger: quiet,
  })
  // `newSession` reads the live connection only for its request; no child process is needed.
  Reflect.set(agent, 'live', {
    child: {},
    generation: 0,
    init: {},
    connection: {
      agent: {
        request: (method: string, params: unknown) => {
          requests.push({ method, params })
          return Promise.resolve({ sessionId: 'session-1', configOptions: [] })
        },
      },
    },
  })
  return { agent, requests }
}

afterEach(() => {
  installMcpServerSource(undefined)
})

describe('MCP server mapping', () => {
  it('maps a stdio entry onto the ACP stdio server', () => {
    const logger = recordingLogger()
    expect(collectAcpMcpServers(loaderOf(entryOf(STDIO)), logger)).toEqual([
      { name: 'memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: [{ name: 'MEMORY_FILE', value: '/tmp/memory.json' }] },
    ])
    expect(logger.warnings).toEqual([])
  })

  it('maps a Streamable HTTP entry onto the ACP http transport and drops DSH-only settings', () => {
    const logger = recordingLogger()
    expect(collectAcpMcpServers(loaderOf(entryOf(HTTP)), logger)).toEqual([
      { type: 'http', name: 'context7', url: 'https://mcp.context7.com/mcp', headers: [{ name: 'Authorization', value: 'Bearer test-token' }] },
    ])
    expect(logger.warnings).toEqual([])
  })

  it('offers a legacy sse entry as the same URL-based ACP transport', () => {
    const sse = { transport: 'sse', serverName: 'legacy', url: 'https://example.test/sse', headers: {} }
    expect(collectAcpMcpServers(loaderOf(entryOf(sse)), quiet)).toEqual([
      { type: 'http', name: 'legacy', url: 'https://example.test/sse', headers: [] },
    ])
  })

  it('skips a config ACP cannot carry and says why', () => {
    const logger = recordingLogger()
    const unsupported = { transport: 'websocket', serverName: 'bus', url: 'wss://example.test/mcp' }
    expect(collectAcpMcpServers(loaderOf(entryOf(unsupported)), logger)).toEqual([])
    expect(logger.warnings).toHaveLength(1)
    expect(logger.warnings[0]).toMatch(/MCP server not forwarded: MCP server "bus" uses unsupported transport "websocket"/)
  })

  it('warns when a stdio entry working directory cannot be forwarded', () => {
    const logger = recordingLogger()
    const servers = collectAcpMcpServers(loaderOf(entryOf({ ...STDIO, cwd: '/work' })), logger)
    expect(servers).toEqual([
      { name: 'memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: [{ name: 'MEMORY_FILE', value: '/tmp/memory.json' }] },
    ])
    expect(logger.warnings).toHaveLength(1)
    expect(logger.warnings[0]).toMatch(/cannot forward the working directory of MCP server "memory"/)
  })

  it('skips disabled entries, entries without a running fiber, and non-MCP configs', () => {
    const disabled = entryOf(STDIO, true)
    const notStarted: McpLoaderEntry = { disabled: false, fiber: undefined }
    const otherPlugin = entryOf({ providers: { deepseek: {} } })
    const logger = recordingLogger()
    expect(collectAcpMcpServers(loaderOf(disabled, notStarted, otherPlugin), logger)).toEqual([])
    expect(logger.warnings).toEqual([])
  })

  it('keeps the first of two entries claiming one server name', () => {
    const logger = recordingLogger()
    const servers = collectAcpMcpServers(loaderOf(entryOf(STDIO), entryOf({ ...STDIO, command: 'node' })), logger)
    expect(servers).toEqual([
      { name: 'memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: [{ name: 'MEMORY_FILE', value: '/tmp/memory.json' }] },
    ])
    expect(logger.warnings).toHaveLength(1)
    expect(logger.warnings[0]).toMatch(/configured more than once/)
  })

  it('returns nothing when the host has no Loader', () => {
    expect(collectAcpMcpServers(undefined, quiet)).toEqual([])
  })
})

describe('session/new mcpServers', () => {
  const server: McpServer = { name: 'memory', command: 'npx', args: [], env: [] }

  it('forwards the installed servers in the session/new request', async () => {
    installMcpServerSource(() => [server])
    const { agent, requests } = stubAgent(profileOf())
    const session = await agent.newSession('/work')
    expect(session.sessionId).toBe('session-1')
    expect(requests).toEqual([{ method: 'session/new', params: { cwd: '/work', mcpServers: [server] } }])
  })

  it('keeps the previous empty list when nothing is installed', async () => {
    const { agent, requests } = stubAgent(profileOf())
    await agent.newSession('/work')
    expect(requests).toEqual([{ method: 'session/new', params: { cwd: '/work', mcpServers: [] } }])
  })

  it('offers no server when the profile sets forwardMcp: false', async () => {
    installMcpServerSource(() => [server])
    const { agent, requests } = stubAgent(profileOf({ forwardMcp: false }))
    await agent.newSession('/work')
    expect(requests).toEqual([{ method: 'session/new', params: { cwd: '/work', mcpServers: [] } }])
  })

  it('lets an explicit list override what the host forwards', async () => {
    installMcpServerSource(() => [server])
    const explicit: McpServer = { type: 'http', name: 'explicit', url: 'https://example.test/mcp', headers: [] }
    const { agent, requests } = stubAgent(profileOf())
    await agent.newSession('/work', undefined, [explicit])
    expect(requests).toEqual([{ method: 'session/new', params: { cwd: '/work', mcpServers: [explicit] } }])
  })

  it('keeps forwardMcp: false authoritative over an explicit list', async () => {
    installMcpServerSource(() => [server])
    const { agent, requests } = stubAgent(profileOf({ forwardMcp: false }))
    await agent.newSession('/work', undefined, [server])
    expect(requests).toEqual([{ method: 'session/new', params: { cwd: '/work', mcpServers: [] } }])
  })
})

describe('plugin installation', () => {
  it('resolves the hosted MCP entries and stops forwarding after disposal', async () => {
    const ctx = new Context()
    ctx.plugin(LlmRuntime)
    ctx.provide('loader', { entries: () => [entryOf(STDIO)] })
    const fiber = ctx.plugin(plugin, { agents: {} })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect([...installedMcpServers()]).toEqual([
      { name: 'memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: [{ name: 'MEMORY_FILE', value: '/tmp/memory.json' }] },
    ])
    await fiber.dispose()
    expect([...installedMcpServers()]).toEqual([])
  })
})
