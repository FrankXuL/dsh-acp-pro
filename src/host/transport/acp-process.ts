/**
 * Owns one ACP agent subprocess: spawning it, collecting its stderr tail, and tearing down the
 * whole tree it leads.
 *
 * Separated from protocol semantics (handshake, sessions, prompts) so the two change for
 * different reasons: this file changes when process handling or platform behaviour changes,
 * the protocol module changes when ACP does.
 *
 * The child is spawned `detached` on POSIX so it leads its own process group. That matters
 * beyond tidiness: agents start their MCP servers as grandchildren, and a single-pid kill leaves
 * those running as orphans. Only a group signal reaches them.
 */

import type { ChildProcess } from 'node:child_process'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'

/** How much of an agent's stderr to keep for diagnostics. */
export const STDERR_TAIL_BYTES = 4096

/** What an agent subprocess needs to be started. */
export interface ProcessSpec {
  command: string
  args: readonly string[]
  cwd?: string
  env: Record<string, string>
}

/** One live subprocess plus the stderr tail observed for it. */
export interface OwnedProcess {
  readonly child: ChildProcess
  /** Most recent stderr, bounded to {@link STDERR_TAIL_BYTES}. */
  stderrTail(): string
  /** Suffix to append to an error message: the stderr tail, when there is one. */
  stderrSuffix(): string
  /**
   * Signal the agent *and everything it spawned*.
   *
   * On POSIX the child leads its own group, so a negative pid reaches grandchildren. Windows has
   * no process-group signal here, so it falls back to a single-pid kill.
   *
   * @param signal - signal to deliver.
   */
  killTree(signal: NodeJS.Signals): void
}

/**
 * Start one agent subprocess and attach stderr capture.
 *
 * Startup failures surface through the returned child's `error` / `exit` events rather than a
 * rejection here: the caller is already racing those against the handshake timeout.
 *
 * @param spec - command, arguments, working directory and environment.
 * @returns the owned process handle.
 */
export function startProcess(spec: ProcessSpec): OwnedProcess {
  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd ?? homedir(),
    env: { ...process.env, ...spec.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: process.platform === 'win32',
    // Lead its own process group so killTree can signal the whole tree.
    detached: process.platform !== 'win32',
  })

  let stderrTail = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES)
  })

  const stderrSuffix = (): string => {
    const tail = stderrTail.trim()
    return tail.length === 0 ? '' : `\n${tail}`
  }

  return {
    child,
    stderrTail: () => stderrTail,
    stderrSuffix,
    killTree: (signal: NodeJS.Signals): void => {
      if (child.exitCode !== null || child.signalCode !== null)
        return
      if (process.platform !== 'win32' && child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal)
          return
        }
        catch {
          // The group is already gone, or `detached` did not take effect; fall through
          // to the direct kill so a single doomed child is still signalled.
        }
      }
      child.kill(signal)
    },
  }
}
