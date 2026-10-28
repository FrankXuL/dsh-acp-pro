import type { Context } from '@deepseek-ai/cordis'
import type { TypertRegistryContract } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import type { AcpSessionControl } from '../shared/session-control.ts'
import { ACP_SESSION_CONTROL_CONTRIBUTION } from '../shared/session-control-remote.ts'

const ACP_SESSION_CONTROL_HOST_CONTRIBUTION = {
  package: 'dsh-acp-pro',
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: ACP_SESSION_CONTROL_CONTRIBUTION.descriptors,
} satisfies TypertContribution

/** Register the existing adapter as the service behind the strict DSH Remote contribution. */
export async function registerAcpSessionControlBridge(
  ctx: Context,
  control: AcpSessionControl,
): Promise<(() => Promise<void>) | undefined> {
  const typedContext = ctx as Context & { typert?: TypertRegistryContract }
  const typert = typedContext.typert ?? ctx.get('typert') as TypertRegistryContract | undefined
  if (typeof typert?.register !== 'function')
    return undefined

  let bindTypertRemote: typeof import('@deepseek-ai/dsh-typert-protocol').bindTypertRemote
  try {
    const protocol = await import('@deepseek-ai/dsh-typert-protocol')
    if (typeof protocol.bindTypertRemote !== 'function')
      return undefined
    bindTypertRemote = protocol.bindTypertRemote
  }
  catch {
    return undefined
  }

  Object.assign(control, {
    typertRemote: bindTypertRemote(control, 'acpSessionControl', { namespace: 'acpSessionControl' }),
  })
  const dispose = typert.register(ACP_SESSION_CONTROL_HOST_CONTRIBUTION)
  try {
    ctx.provide('acpSessionControl', control)
    return dispose
  }
  catch (error) {
    await dispose()
    throw error
  }
}
