/** ACP session controls shared by the Host bridge and the Client panel. */

export type AcpSessionTurnState = 'idle' | 'running' | 'unknown'

export type AcpSessionRecovery = 'new' | 'loaded'

export interface AcpSessionConfigValue {
  value: string
  name: string
  description?: string
}

export interface AcpSessionConfigGroup {
  group: string
  name: string
  options: AcpSessionConfigValue[]
}

export type AcpSessionConfigChoice = AcpSessionConfigValue | AcpSessionConfigGroup

/** The supported, SDK-shaped subset of an ACP select configuration option. */
export interface AcpSessionSelectConfigOption {
  type: 'select'
  id: string
  name: string
  category?: string
  description?: string
  currentValue: string
  options: AcpSessionConfigChoice[]
}

export interface AcpSessionMode {
  id: string
  name: string
  description?: string
}

export interface AcpSessionCommand {
  name: string
  description: string
  inputHint?: string
}

export interface AcpSessionSnapshot {
  provider: string
  /** DSH session ID. */
  sessionId: string
  acpSessionId?: string
  turnState: AcpSessionTurnState
  /** Host-local ordering token; it is not an ACP revision. */
  revision: number
  configOptions: AcpSessionSelectConfigOption[]
  currentModeId?: string
  availableModes: AcpSessionMode[]
  availableCommands: AcpSessionCommand[]
  recovery: AcpSessionRecovery
}

/** Host methods exposed to the UI bridge for one DSH conversation. */
export interface AcpSessionControl {
  getSessionSnapshots(dshSessionId: string): Promise<AcpSessionSnapshot[]>
  setSessionConfig(provider: string, sessionId: string, configId: string, value: string, expectedRevision?: number): Promise<AcpSessionSnapshot>
  setSessionMode(provider: string, sessionId: string, modeId: string, expectedRevision?: number): Promise<AcpSessionSnapshot>
  resetSession(provider: string, sessionId: string): Promise<void>
}
