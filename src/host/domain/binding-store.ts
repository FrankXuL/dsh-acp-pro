import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AcpBindingRecord } from './binding.ts'
import { isBindingRecord } from './binding.ts'

export interface AcpBindingStore {
  load(provider: string, dshSessionId: string): Promise<AcpBindingRecord | undefined>
  save(record: AcpBindingRecord): Promise<void>
  remove(provider: string, dshSessionId: string): Promise<void>
}

function bindingKey(provider: string, dshSessionId: string): string {
  return createHash('sha256').update(`${provider}\0${dshSessionId}`).digest('hex')
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
    if (!isBindingRecord(parsed) || parsed.provider !== provider || parsed.dshSessionId !== dshSessionId)
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
