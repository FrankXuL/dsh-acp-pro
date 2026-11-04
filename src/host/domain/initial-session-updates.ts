import type { SessionUpdate } from '@agentclientprotocol/sdk'

type ConfigOptionUpdate = Extract<SessionUpdate, { sessionUpdate: 'config_option_update' }>
type CurrentModeUpdate = Extract<SessionUpdate, { sessionUpdate: 'current_mode_update' }>
type AvailableCommandsUpdate = Extract<SessionUpdate, { sessionUpdate: 'available_commands_update' }>

/** Update kind → the session field it folds into; anything else is a tool-call row. */
const SETTING_SLOT = {
  config_option_update: 'config',
  current_mode_update: 'mode',
  available_commands_update: 'commands',
} as const

interface BufferedSettings {
  config?: ConfigOptionUpdate
  mode?: CurrentModeUpdate
  commands?: AvailableCommandsUpdate
}

/**
 * Updates an agent sends between asking for a session and the client being ready for them.
 *
 * `session/new` returns after the agent has already announced its settings, and codex-acp
 * additionally reports a by-name MCP skip as a `tool_call` on that same channel — before any
 * turn owns the record sink. Settings fold into the session; tool-call rows are held and handed
 * to the listener and the first sink, because dropping them hides a row the user reads and would
 * also swallow a real startup failure, which travels the identical channel.
 *
 * Pure hold-and-take: no agent, no logger, no session. Callers decide when to drain.
 */
export class InitialSessionUpdates {
  private readonly settings: BufferedSettings = {}
  private readonly tools: SessionUpdate[] = []

  /** Keep one update. Settings are last-write-wins; tool-call rows keep arrival order. */
  add(update: SessionUpdate): void {
    const slot = SETTING_SLOT[update.sessionUpdate as keyof typeof SETTING_SLOT]
    if (slot === undefined)
      this.tools.push(update)
    else
      (this.settings as Record<string, SessionUpdate>)[slot] = update
  }

  /** Hand the settings to the session, leaving the held tool-call rows untouched. */
  applySettings(fold: (settings: BufferedSettings) => void): void {
    fold(this.settings)
    for (const key of Object.keys(this.settings))
      delete (this.settings as Record<string, unknown>)[key]
  }

  /** Remove and return every held tool-call row, oldest first. */
  takeTools(): SessionUpdate[] {
    const rows = [...this.tools]
    this.tools.length = 0
    return rows
  }

  /** Hand every held row to a sink, which may be absent when a turn is ephemeral. */
  drainTo(sink: { push: (update: SessionUpdate) => void } | undefined): void {
    for (const row of this.takeTools())
      sink?.push(row)
  }

  /** Settings updates still buffered, for a listener that replays them verbatim. */
  get pendingSettings(): SessionUpdate[] {
    return [this.settings.config, this.settings.mode, this.settings.commands]
      .filter((update): update is NonNullable<typeof update> => update !== undefined)
  }
}
