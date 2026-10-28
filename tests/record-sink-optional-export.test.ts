import type { Session } from '@deepseek-ai/dsh-session'
import type { AdapterHost, HostLogger } from '../src/host/types/index.ts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-session', () => ({ appendPluginRecord: undefined }))

import { createAcpRecordSink } from '../src/host/service/acp-record-sink.ts'
import { AcpAdapter } from '../src/host/service/acp-adapter.ts'

describe('optional DSH plugin record export', () => {
  it('lets the ACP adapter continue without a sink when appendPluginRecord is absent', () => {
    const logger: HostLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const session = { sessionId: 'dsh-1' } as unknown as Session
    const host = {
      logger,
      agentOf: () => undefined,
      startRecording: () => createAcpRecordSink(session, logger),
    } as unknown as AdapterHost
    const adapter = new AcpAdapter(host, () => new Map())

    expect(adapter).toBeInstanceOf(AcpAdapter)
    expect(host.startRecording!('dsh-1')).toBeUndefined()
    adapter.dispose()
  })
})
