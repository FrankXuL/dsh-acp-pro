/**
 * The Host-side half of the cross-source rule: what the adapter does when a conversation's turn
 * would switch the source executing it.
 *
 * The rule itself is unit-tested in `source-change.test.ts`; here we only check the wiring — that
 * a refusal prevents the turn, and that no approval surface means the turn proceeds.
 */

import type { AdapterHost, ApprovalOutcome } from '../src/host/types/index.ts'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { AcpAdapter } from '../src/host/service/acp-adapter.ts'
import { ContextWindows } from '../src/host/service/context-windows.ts'

const MOCK = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
const ROUTE = 'mock'
const WORKSPACE = fileURLToPath(new URL('.', import.meta.url))

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

function profile(command = MOCK) {
  return {
    command,
    args: [MOCK],
    displayName: 'Mock',
    permission: 'ask' as const,
    models: [],
    contextWindow: 200_000,
    discoverModels: false,
    startupTimeoutMs: 10_000,
    idleTimeoutMs: 10_000,
  }
}

function host(approve?: (toolName: string) => ApprovalOutcome): AdapterHost {
  return {
    logger: silentLogger,
    agentOf: () => ({ session: { header: { cwd: WORKSPACE } } }) as never,
    approve: approve === undefined ? undefined : async request => approve(request.toolName),
  }
}

let counter = 0
function user(text: string): never {
  return { id: `m${++counter}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } as never
}

function request(provider: string, messages: unknown[]): GenerateOptions {
  return { provider, model: 'mock-fast', messages, sessionId: 'dsh-cross' as never } as never
}

const adapters: AcpAdapter[] = []
function create(h: AdapterHost, routes: string[]): AcpAdapter {
  const adapter = new AcpAdapter(h, () => new Map(routes.map(route => [route, profile()])), new ContextWindows())
  adapters.push(adapter)
  return adapter
}

/** Collect the terminal chunk, which is where the adapter reports a refused turn. */
async function drain(adapter: AcpAdapter, options: GenerateOptions): Promise<{ finish?: { reason?: { kind: string } } } | undefined> {
  let last: { finish?: { reason?: { kind: string } } } | undefined
  for await (const chunk of adapter.stream(options))
    last = chunk as never
  return last
}

afterEach(() => {
  for (const adapter of adapters.splice(0))
    adapter.dispose()
})

describe('cross-source confirmation', () => {
  it('never asks within one conversation on one source', async () => {
    const asked: string[] = []
    const adapter = create(host(name => {
      asked.push(name)
      return 'allowed-once'
    }), [ROUTE])

    await drain(adapter, request(ROUTE, [user('one')]))
    await drain(adapter, request(ROUTE, [user('one'), user('two')]))

    expect(asked).toEqual([])
  })

  it('proceeds without asking when the host has no approval surface', async () => {
    // A host that cannot ask must still be able to run the turn.
    const adapter = create(host(undefined), [ROUTE])
    await expect(drain(adapter, request(ROUTE, [user('hello')]))).resolves.toBeDefined()
  })

  it('asks once per pair, then remembers the answer', async () => {
    const asked: string[] = []
    const adapter = create(host(name => {
      asked.push(name)
      return 'allowed-once'
    }), [ROUTE, 'second'])

    await drain(adapter, request(ROUTE, [user('start on mock')]))
    await drain(adapter, request('second', [user('start on mock'), user('switch once')]))
    // Same pair again: already answered for this conversation.
    await drain(adapter, request('second', [user('start on mock'), user('switch once'), user('switch twice')]))

    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain(ROUTE)
    expect(asked[0]).toContain('second')
  })

  it('reports a failed turn when the user declines the crossing', async () => {
    const adapter = create(host(() => 'rejected'), [ROUTE, 'second'])

    await drain(adapter, request(ROUTE, [user('start on mock')]))
    const last = await drain(adapter, request('second', [user('start on mock'), user('cross')]))

    // The adapter's contract is to report failures as a terminal `finish` chunk, not to throw.
    expect(JSON.stringify(last)).toContain('declined')
  })
})
