/**
 * PROTOTYPE v3 (`wayfinder` ticket #04): register a shadow occupant for the composer's
 * `conversation.input.model` seat at `priority: -1`. v3 fixes the nested `inject` dependency
 * list (slots/configForms) that made v2 stay dormant, and adds a visible diagnostic chip plus
 * an error boundary so a failed shadow is observable instead of silently falling back.
 * Throwaway; delete with the component when #04 closes.
 */
import type { ComponentType, ReactElement, ReactNode } from 'react'
import type { AcpClientContext, ModelSelection } from '../types/runtime.ts'
import { Component, createElement, useEffect, useState } from 'react'
import { PLUGIN_ID } from '../../shared/constants.ts'
import { NS } from '../locales/index.ts'
import { ModelSeatProto, PROTO_CSS } from '../components/model-seat-proto.tsx'

class SeatBoundary extends Component<{ children: ReactNode }, { failed: boolean, message: string }> {
  state: { failed: boolean, message: string } = { failed: false, message: '' }

  static getDerivedStateFromError(error: unknown): { failed: boolean, message: string } {
    return { failed: true, message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown): void {
    console.error(`${PLUGIN_ID}: prototype seat render failed`, error)
  }

  render(): ReactNode {
    if (this.state.failed)
      return createElement('span', { style: { color: 'tomato', fontSize: 12 }, title: this.state.message }, `PROTO 渲染失败: ${this.state.message.slice(0, 120)}`)
    return this.props.children
  }
}

/** Mutable diagnostics rendered by the chip; updated by the registration path. */
const protoDiag = { text: 'boot' }

function DiagnosticChip(): ReactElement | null {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick(tick => tick + 1), 500)
    return () => clearInterval(timer)
  }, [])
  return createElement(
    'span',
    { title: `dsh-acp-pro prototype: ${protoDiag.text}`, style: { fontSize: 10, opacity: 0.85, padding: '0 4px', color: protoDiag.text === 'registered' ? 'var(--dsw-alias-state-success-primary, #4caf50)' : 'orange' } },
    `PROTO ${protoDiag.text}`,
  )
}

export function registerModelSeatProto(ctx: AcpClientContext): () => void {
  let disposeSeat: (() => void) | undefined
  let disposeChip: (() => void) | undefined
  // Prototype sheet: the panel uses class names so it can carry hover/active states.
  let style: HTMLStyleElement | undefined
  try {
    style = document.createElement('style')
    style.dataset.owner = `${PLUGIN_ID}:prototype`
    style.textContent = PROTO_CSS
    document.head.append(style)
  }
  catch (error) {
    console.warn(`${PLUGIN_ID}: prototype styles unavailable`, error)
  }
  // Every service read inside the callback must be listed: v2 injected only `modelDirectories`
  // and then touched `slots`/`configForms`, so the callback could never run (or threw) silently.
  // Diagnostic lives outside the nested inject: it only needs `slots`, so it tells us whether
  // the bundle loaded even when the seat's service dependencies never resolve.
  try {
    disposeChip = ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left',
      order: 1000,
      locale: NS,
    }, DiagnosticChip as ComponentType<any>))
    protoDiag.text = 'bundle-loaded'
  }
  catch (error) {
    protoDiag.text = 'chip-error'
    console.warn(`${PLUGIN_ID}: prototype diagnostic chip unavailable`, error)
  }
  ctx.inject(['slots', 'modelDirectories', 'configForms', 'sessions'], (scope) => {
    const owned = scope as unknown as AcpClientContext
    protoDiag.text = 'deps-ready'
    disposeSeat = owned.slots.inject('conversation.input.model', () => {
      try {
        const dispose = owned.slots.register({
          name: 'conversation.input.model',
          priority: -1,
          locale: NS,
          inject: (sessionId: string) => {
            const directory = owned.modelDirectories.directoryFor(sessionId)
            const sessions = (owned as unknown as { sessions?: { subagentAddress: (id: string) => unknown } }).sessions
            return {
              // The native seat hides itself in addressed subagent sessions; mirror that here.
              available: sessions?.subagentAddress(sessionId) === undefined,
              models: {
                store: directory.store,
                load: () => directory.load(),
                select: (selection: ModelSelection) => directory.select(selection),
              },
              config: owned.configForms.get(PLUGIN_ID),
            }
          },
        }, ((props: any) => createElement(SeatBoundary, null, createElement(ModelSeatProto as ComponentType<any>, props))) as ComponentType<any>)
        protoDiag.text = 'registered'
        console.info(`${PLUGIN_ID}: prototype model seat registered (priority -1)`)
        return dispose
      }
      catch (error) {
        // Keep the native seat: a registration failure must never take `/model` down with it.
        protoDiag.text = `register-error: ${error instanceof Error ? error.message : String(error)}`
        console.error(`${PLUGIN_ID}: prototype model seat registration failed; native seat kept`, error)
        return () => {}
      }
    })
  })
  return () => {
    disposeSeat?.()
    disposeChip?.()
    style?.remove()
    disposeSeat = undefined
    disposeChip = undefined
    style = undefined
  }
}
