import type { PromptCapabilities } from '@agentclientprotocol/sdk'
import type { HostLogger } from '../types/index.ts'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PLUGIN_ID } from '../../shared/constants.ts'

/**
 * The prompt content one ACP agent accepts, exactly as its `initialize` answer declares it.
 * ACP has no other place to ask: an agent states its accepted content types once, during
 * the handshake, so the answer is learned by starting the agent and kept afterwards.
 */
export interface AcpPromptCapabilities {
  image: boolean
  audio: boolean
  embeddedContext: boolean
}

/** Read an `initialize` answer's prompt capabilities; every absent flag is a negative. */
export function promptCapabilitiesOf(capabilities: PromptCapabilities | null | undefined): AcpPromptCapabilities {
  return {
    image: capabilities?.image === true,
    audio: capabilities?.audio === true,
    embeddedContext: capabilities?.embeddedContext === true,
  }
}

interface Entry extends AcpPromptCapabilities {
  /** Fingerprint of the spawn facts that produced this answer. */
  facts: string
}

function fingerprint(facts: string): string {
  return createHash('sha256').update(facts).digest('hex').slice(0, 16)
}

function entryOf(value: unknown): Omit<Entry, 'facts'> & { facts: unknown } | undefined {
  if (typeof value !== 'object' || value === null)
    return undefined
  const record = value as Record<string, unknown>
  return {
    facts: record.facts,
    image: record.image === true,
    audio: record.audio === true,
    embeddedContext: record.embeddedContext === true,
  }
}

/**
 * Prompt capabilities agents answered with during `initialize`, keyed by route. dsh asks a
 * route what input it accepts before the user can attach anything, which is earlier than the
 * first turn that would start the agent; with a `file` the last answer survives restarts, so
 * a route reports image input straight away instead of claiming text only until it is used.
 *
 * Each entry remembers the spawn facts it came from: a route pointed at a different command
 * answers for a different agent, so its stored answer is ignored until the new one speaks.
 */
export class PromptCapabilitiesCache {
  private readonly entries = new Map<string, Entry>()
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly file?: string, private readonly logger?: HostLogger) {
    if (file === undefined)
      return
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      for (const [route, value] of Object.entries(stored)) {
        const entry = entryOf(value)
        if (entry !== undefined && typeof entry.facts === 'string')
          this.entries.set(route, { ...entry, facts: entry.facts })
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        logger?.warn(`${PLUGIN_ID}: ignoring unreadable prompt capability cache ${file}`, error)
    }
  }

  get(route: string, facts: string): AcpPromptCapabilities | undefined {
    const entry = this.entries.get(route)
    if (entry === undefined || entry.facts !== fingerprint(facts))
      return undefined
    return { image: entry.image, audio: entry.audio, embeddedContext: entry.embeddedContext }
  }

  set(route: string, facts: string, capabilities: AcpPromptCapabilities): void {
    const entry: Entry = { ...capabilities, facts: fingerprint(facts) }
    const known = this.entries.get(route)
    if (known !== undefined && known.facts === entry.facts && known.image === entry.image && known.audio === entry.audio && known.embeddedContext === entry.embeddedContext)
      return
    this.entries.set(route, entry)
    const file = this.file
    if (file === undefined)
      return
    const snapshot = Object.fromEntries(this.entries)
    this.saving = this.saving
      .then(async () => {
        mkdirSync(dirname(file), { recursive: true })
        await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`)
      })
      .catch((error: unknown) => {
        this.logger?.warn(`${PLUGIN_ID}: could not save prompt capability cache ${file}`, error)
      })
  }

  /** Settles once every answer stored so far is on disk. */
  flush(): Promise<void> {
    return this.saving
  }
}
