import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AcpSessionControl } from '../src/shared/session-control.ts'
import type { AcpSessionControlClient } from '../src/shared/session-control-remote.ts'
import { describe, expect, it, vi } from 'vitest'
import { registerAcpSessionControlBridge } from '../src/host/dsh-session-control.ts'
import { SessionControlPanel, insertSessionCommand } from '../src/client/components/session-control-panel.tsx'
import { mountSessionControlRemote } from '../src/client/register/session-control-remote.ts'
import type { AcpClientContext } from '../src/client/types/runtime.ts'
import { ACP_SESSION_CONTROL_CONTRIBUTION } from '../src/shared/session-control-remote.ts'

const snapshot = {
  provider: 'codex',
  sessionId: 'dsh-1',
  turnState: 'idle',
  revision: 4,
  configOptions: [{
    type: 'select',
    id: 'reasoning_effort',
    name: 'Reasoning effort',
    category: 'mode',
    currentValue: 'high',
    options: [
      { value: 'medium', name: 'Medium' },
      { group: 'fast', name: 'Fast', options: [{ value: 'low', name: 'Low' }] },
    ],
  }],
  availableModes: [],
  availableCommands: [{ name: 'review', description: 'Review changes', inputHint: 'files' }],
  recovery: 'loaded',
} as const

function mountedControl(): AcpSessionControlClient {
  return {
    getSessionSnapshots: vi.fn(),
    setSessionConfig: vi.fn(),
    setSessionMode: vi.fn(),
    resetSession: vi.fn(),
  } as unknown as AcpSessionControlClient
}

describe('ACP session control bridge', () => {
  it('registers the adapter through the real Typert Host registry', async () => {
    const ctx = new Context()
    const registryFiber = ctx.plugin(TypertRegistry)
    await registryFiber
    const control = {
      getSessionSnapshots: vi.fn(async () => []),
      setSessionConfig: vi.fn(),
      setSessionMode: vi.fn(),
      resetSession: vi.fn(),
    } as unknown as AcpSessionControl

    const dispose = await registerAcpSessionControlBridge(ctx, control)

    expect(dispose).toBeTypeOf('function')
    expect(ctx.typert.local.get('acpSessionControl/getSessionSnapshots')).toEqual(ACP_SESSION_CONTROL_CONTRIBUTION.descriptors[0])
    expect(ctx.get('acpSessionControl')).toMatchObject({
      typertRemote: { service: control, serviceKey: 'acpSessionControl', namespace: 'acpSessionControl' },
    })
    await dispose?.()
    expect(ctx.typert.local.get('acpSessionControl/getSessionSnapshots')).toBeUndefined()
    await registryFiber.dispose()
  })

  it('leaves the bridge unavailable when the Host has no Typert registry', async () => {
    const provide = vi.fn()
    const ctx = { get: vi.fn(() => undefined), provide } as unknown as Context

    await expect(registerAcpSessionControlBridge(ctx, {} as AcpSessionControl)).resolves.toBeUndefined()
    expect(provide).not.toHaveBeenCalled()
  })

  it('keeps every wire field strict and validates both encoded and decoded DTOs', () => {
    const descriptors = ACP_SESSION_CONTROL_CONTRIBUTION.descriptors
    expect(descriptors.map(item => item.method)).toEqual([
      'getSessionSnapshots', 'setSessionConfig', 'setSessionMode', 'resetSession',
    ])
    for (const descriptor of descriptors) {
      expect(descriptor.service).toBe('acpSessionControl')
      expect(descriptor.namespace).toBe('acpSessionControl')
      expect(descriptor.result.mode).toBe('strict')
      expect(typeof descriptor.result.create().parse).toBe('function')
      expect(typeof descriptor.result.encode).toBe('function')
      expect(typeof descriptor.result.decode).toBe('function')
      for (const parameter of descriptor.parameters)
        expect(parameter.codec.mode).toBe('strict')
    }

    const listCodec = descriptors[0]!.result
    expect(listCodec.decode([snapshot])).toEqual([snapshot])
    expect(listCodec.encode([snapshot], () => null)).toEqual([snapshot])
    expect(() => listCodec.decode([{ ...snapshot, unexpected: true }])).toThrow()

    const revision = descriptors[1]!.parameters.at(-1)!
    expect(revision.acceptsUndefined).toBe(true)
    expect(revision.codec.decode(undefined)).toBeUndefined()
  })

  it('mounts the contribution before registering the session input dock and withdraws both', async () => {
    const order: string[] = []
    const disposeRemote = vi.fn(async () => { order.push('unmount remote') })
    const disposePanel = vi.fn(() => { order.push('unregister panel') })
    const slots = {
      inject: vi.fn((_slot: string, register: () => unknown) => {
        order.push('register panel')
        register()
        return disposePanel
      }),
      register: vi.fn(() => vi.fn()),
    }
    const remote = {
      llm: {},
      $mount: vi.fn(async (contribution: unknown) => {
        order.push('mount remote')
        expect(contribution).toBe(ACP_SESSION_CONTROL_CONTRIBUTION)
        return disposeRemote
      }),
      acpSessionControl: mountedControl(),
    }
    const ctx = {
      remote,
      slots,
      locale: { bind: vi.fn(() => (key: string) => key) },
    } as unknown as AcpClientContext

    const dispose = await mountSessionControlRemote(ctx)
    expect(order).toEqual(['mount remote', 'register panel'])
    expect(slots.register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'conversation.input.dock',
      id: 'acp-session-control',
    }), SessionControlPanel)

    await dispose()
    expect(order.slice(-2)).toEqual(['unregister panel', 'unmount remote'])
  })

  it('keeps an unsupported Remote from rejecting the client effect or registering a panel', async () => {
    const error = new Error('Remote API unavailable')
    const warn = vi.fn()
    const slots = { inject: vi.fn(), register: vi.fn() }
    const ctx = {
      remote: {
        llm: {},
        $mount: vi.fn(async () => { throw error }),
        acpSessionControl: mountedControl(),
      },
      slots,
      locale: { bind: vi.fn(() => (key: string) => key) },
      logger: { warn },
    } as unknown as AcpClientContext

    const dispose = await mountSessionControlRemote(ctx)
    expect(slots.inject).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ACP session controls are unavailable'), error)
    await expect(dispose()).resolves.toBeUndefined()
  })

  it('withdraws a successful Remote mount if the panel registration fails', async () => {
    const error = new Error('slot registry refused registration')
    const warn = vi.fn()
    const disposeRemote = vi.fn(async () => {})
    const slots = {
      inject: vi.fn(() => { throw error }),
      register: vi.fn(),
    }
    const ctx = {
      remote: {
        llm: {},
        $mount: vi.fn(async () => disposeRemote),
        acpSessionControl: mountedControl(),
      },
      slots,
      locale: { bind: vi.fn(() => (key: string) => key) },
      logger: { warn },
    } as unknown as AcpClientContext

    const dispose = await mountSessionControlRemote(ctx)
    expect(disposeRemote).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ACP session controls are unavailable'), error)
    await dispose()
    expect(disposeRemote).toHaveBeenCalledOnce()
  })

  it('unmounts a contribution when the expected namespace methods are missing', async () => {
    const warn = vi.fn()
    const disposeRemote = vi.fn(async () => {})
    const slots = { inject: vi.fn(), register: vi.fn() }
    const ctx = {
      remote: {
        llm: {},
        $mount: vi.fn(async () => disposeRemote),
        acpSessionControl: {},
      },
      slots,
      locale: { bind: vi.fn(() => (key: string) => key) },
      logger: { warn },
    } as unknown as AcpClientContext

    const dispose = await mountSessionControlRemote(ctx)
    expect(disposeRemote).toHaveBeenCalledOnce()
    expect(slots.inject).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ACP session controls are unavailable'), expect.any(Error))
    await dispose()
    expect(disposeRemote).toHaveBeenCalledOnce()
  })

  it('inserts a command at the captured composer selection without submitting', () => {
    const span = { start: 2, end: 5, draftRev: 8 }
    const actions = {
      captureInsertion: vi.fn(() => span),
      insertText: vi.fn(() => true),
      submit: vi.fn(),
    } as unknown as InputActions

    expect(insertSessionCommand(actions, 'review')).toBe(true)
    expect(actions.captureInsertion).toHaveBeenCalledOnce()
    expect(actions.insertText).toHaveBeenCalledWith('/review ', span)
    expect(actions.submit).not.toHaveBeenCalled()
  })
})
