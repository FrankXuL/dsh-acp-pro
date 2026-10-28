/**
 * The ACP turn's settlement state machine, extracted from the adapter with no logic change.
 *
 * A turn's result is latched the moment it is known, and draining may continue past it so
 * late output still reaches the transcript. Two rules decide which observation becomes the
 * turn's result:
 *
 * 1. The first settled outcome wins.
 * 2. Once the user aborted, a later response or failure is an echo of that cancellation, never
 *    the turn's result. Agents routinely finish inside the cancel grace window, so without this
 *    precedence an abort would surface as an apparent success.
 */

/** The terminal outcome of one ACP turn, as the adapter observed it. */
export type TurnOutcome =
  | { kind: 'response', response: unknown }
  | { kind: 'error', error: unknown }
  | { kind: 'aborted' }
  | { kind: 'timeout' }

/**
 * Latches the first truthful outcome of one turn.
 *
 * `settle` is called from several observation paths (prompt response, failure, abort, idle
 * timeout) that race with each other; the returned `current()` reads whatever was latched.
 *
 * @returns the settle function and a reader for the latched outcome.
 */
export function createTurnSettlement(): {
  settle: (next: TurnOutcome) => void
  current: () => TurnOutcome | undefined
} {
  let outcome: TurnOutcome | undefined
  return {
    settle: (next: TurnOutcome): void => {
      if (outcome === undefined)
        outcome = next
      else if (outcome.kind === 'aborted' && next.kind !== 'aborted')
        return
    },
    current: (): TurnOutcome | undefined => outcome,
  }
}

/**
 * Reject a turn when the previous one has an unknown result.
 *
 * A previous turn whose result could not be established must not be silently retried or
 * replayed: the ACP agent may already have executed side effects. Only an explicit reset
 * clears this state.
 *
 * @param turnState - the binding's persisted turn state.
 * @param hasPending - whether the binding still holds a pending turn.
 * @returns a message when the turn must be refused, else `undefined`.
 */
export function unknownTurnRefusal(turnState: string, hasPending: boolean): string | undefined {
  return hasPending || turnState === 'unknown'
    ? 'the previous ACP turn has an unknown result; reset this session before continuing'
    : undefined
}
