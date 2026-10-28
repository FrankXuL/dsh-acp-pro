import type { AcpClientContext } from '../types/runtime.ts'
import { PLUGIN_ID } from '../../shared/constants.ts'
import { ACP_SESSION_CONTROL_CONTRIBUTION } from '../../shared/session-control-remote.ts'
import { registerSessionControlPanel } from './session-control-panel.ts'

interface ClientLogger {
  warn: (message: string, error: unknown) => void
}

/** Mount the matching strict Remote contribution before registering its panel. */
export async function mountSessionControlRemote(ctx: AcpClientContext): Promise<() => Promise<void>> {
  let disposeRemote: (() => Promise<void>) | undefined
  let disposePanel: (() => void) | undefined
  try {
    disposeRemote = await ctx.remote.$mount(ACP_SESSION_CONTROL_CONTRIBUTION)
    try {
      const control = ctx.remote.acpSessionControl
      if (typeof control?.getSessionSnapshots !== 'function'
        || typeof control.setSessionConfig !== 'function'
        || typeof control.setSessionMode !== 'function'
        || typeof control.resetSession !== 'function') {
        throw new Error('mounted ACP session control Remote is incomplete')
      }
      disposePanel = registerSessionControlPanel(ctx, control)
    }
    catch (error) {
      const cleanup = disposeRemote
      disposeRemote = undefined
      await cleanup?.()
      throw error
    }
  }
  catch (error) {
    (ctx as AcpClientContext & { logger?: ClientLogger }).logger?.warn(
      `${PLUGIN_ID}: ACP session controls are unavailable; leaving the panel unmounted`,
      error,
    )
  }

  return async () => {
    disposePanel?.()
    await disposeRemote?.()
  }
}
