/**
 * PROTOTYPE (`wayfinder` ticket #04): register a shadow occupant for the composer's
 * `conversation.input.model` seat at `priority: -1` so the icon-rail picker renders instead of
 * the native selector. Throwaway; delete with the component when #04 closes.
 */
import type { ComponentType, ReactNode } from 'react'
import type { AcpClientContext, ModelSelection } from '../types/runtime.ts'
import { Component, createElement } from 'react'
import { PLUGIN_ID } from '../../shared/constants.ts'
import { NS } from '../locales/index.ts'
import { ModelSeatProto, PROTO_CSS } from '../components/model-seat-proto.tsx'

/** A render throw makes the slot engine abdicate the entry permanently; keep it visible. */
class SeatBoundary extends Component<{ children: ReactNode }, { failed: boolean, message: string }> {
  state: { failed: boolean, message: string } = { failed: false, message: '' }

  static getDerivedStateFromError(error: unknown): { failed: boolean, message: string } {
    return { failed: true, message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown): void {
    console.error(`${PLUGIN_ID}: model seat render failed`, error)
  }

  render(): ReactNode {
    if (this.state.failed)
      return createElement('span', { style: { color: 'tomato', fontSize: 12 }, title: this.state.message }, `模型选择器渲染失败: ${this.state.message.slice(0, 120)}`)
    return this.props.children
  }
}

export function registerModelSeatProto(ctx: AcpClientContext): () => void {
  let disposeSeat: (() => void) | undefined
  let style: HTMLStyleElement | undefined
  try {
    style = document.createElement('style')
    style.dataset.owner = `${PLUGIN_ID}:model-seat`
    style.textContent = PROTO_CSS
    document.head.append(style)
  }
  catch (error) {
    console.warn(`${PLUGIN_ID}: model seat styles unavailable`, error)
  }
  // Every service the inject body reads must be listed here: a dependency missing from the
  // scope makes the entry throw at render time (`cannot get property "remote.session" without
  // inject`), and the engine then silently falls back to the native seat.
  ctx.inject(['slots', 'modelDirectories', 'configForms', 'sessions', 'remote', 'remote.session'], (scope) => {
    const owned = scope as unknown as AcpClientContext
    disposeSeat = owned.slots.inject('conversation.input.model', () => {
      try {
        return owned.slots.register({
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
      }
      catch (error) {
        // Keep the native seat: a registration failure must never take `/model` down with it.
        console.error(`${PLUGIN_ID}: model seat registration failed; native seat kept`, error)
        return () => {}
      }
    })
  })
  return () => {
    disposeSeat?.()
    style?.remove()
    disposeSeat = undefined
    style = undefined
  }
}
