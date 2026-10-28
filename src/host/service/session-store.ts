import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Usage } from '@agentclientprotocol/sdk'

export interface AcpPendingTurn {
  id: string
  messageIds: string[]
}

/** Durable minimum needed to reconnect or prevent an uncertain prompt from replaying. */
export interface AcpBindingRecord {
  version: 1
  provider: string
  dshSessionId: string
  acpSessionId?: string
  cwd: string
  protocolVersion: number
  spawnFactsHash: string
  model: string
  usage?: Usage
  consumedIds: string[]
  replayBarrierIds: string[]
  needsFreshInput: boolean
  revision: number
  pending?: AcpPendingTurn
}

export interface AcpBindingStore {
  load(provider: string, dshSessionId: string): Promise<AcpBindingRecord | undefined>
  save(record: AcpBindingRecord): Promise<void>
  remove(provider: string, dshSessionId: string): Promise<void>
}

function bindingKey(provider: string, dshSessionId: string): string {
  return createHash('sha256').update(`${provider}\0${dshSessionId}`).digest('hex')
}

function isRecord(value: unknown): value is AcpBindingRecord {
  if (typeof value !== 'object' || value === null)
    return false
  const record = value as Partial<AcpBindingRecord>
  return record.version === 1
    && typeof record.provider === 'string'
    && typeof record.dshSessionId === 'string'
    && typeof record.cwd === 'string'
    && typeof record.protocolVersion === 'number'
    && typeof record.spawnFactsHash === 'string'
    && typeof record.model === 'string'
    && (record.usage === undefined || (typeof record.usage === 'object' && record.usage !== null))
    && Array.isArray(record.consumedIds)
    && record.consumedIds.every(id => typeof id === 'string')
    && Array.isArray(record.replayBarrierIds)
    && record.replayBarrierIds.every(id => typeof id === 'string')
    && typeof record.needsFreshInput === 'boolean'
    && typeof record.revision === 'number'
    && Number.isSafeInteger(record.revision)
    && record.revision >= 0
    && (record.acpSessionId === undefined || typeof record.acpSessionId === 'string')
    && (record.pending === undefined || (typeof record.pending === 'object' && record.pending !== null && typeof record.pending.id === 'string' && Array.isArray(record.pending.messageIds) && record.pending.messageIds.every(id => typeof id === 'string')))
}

export class MemoryAcpBindingStore implements AcpBindingStore {
  private readonly records = new Map<string, AcpBindingRecord>()

  async load(provider: string, dshSessionId: string): Promise<AcpBindingRecord | undefined> {
    const record = this.records.get(bindingKey(provider, dshSessionId))
    return record === undefined ? undefined : structuredClone(record)
  }

  async save(record: AcpBindingRecord): Promise<void> {
    this.records.set(bindingKey(record.provider, record.dshSessionId), structuredClone(record))
  }

  async remove(provider: string, dshSessionId: string): Promise<void> {
    this.records.delete(bindingKey(provider, dshSessionId))
  }
}

/** Atomic JSON storage under a plugin-owned data directory; filenames reveal no session IDs. */
export class FileAcpBindingStore implements AcpBindingStore {
  constructor(private readonly directory: string) {}

  async load(provider: string, dshSessionId: string): Promise<AcpBindingRecord | undefined> {
    let contents: string
    try {
      contents = await readFile(this.file(provider, dshSessionId), 'utf8')
    }
    catch (error) {
      if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT')
        return undefined
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(contents) as unknown
    }
    catch (error) {
      throw new Error('ACP binding state is corrupt', { cause: error })
    }
    if (!isRecord(parsed) || parsed.provider !== provider || parsed.dshSessionId !== dshSessionId)
      throw new Error('ACP binding state is invalid')
    return parsed
  }

  async save(record: AcpBindingRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const file = this.file(record.provider, record.dshSessionId)
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, file)
    }
    catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      throw error
    }
  }

  async remove(provider: string, dshSessionId: string): Promise<void> {
    await rm(this.file(provider, dshSessionId), { force: true })
  }

  private file(provider: string, dshSessionId: string): string {
    return join(this.directory, `${bindingKey(provider, dshSessionId)}.json`)
  }
}
