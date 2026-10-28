/**
 * The cross-source rule: a conversation is executed by one source at a time, and crossing that
 * boundary is worth saying out loud once.
 */

import { describe, expect, it } from 'vitest'
import {
  PLATFORM_SOURCE,
  classifySourceChange,
  crossingKey,
  decideFromApproval,
  warningFor,
} from '../src/host/domain/source-change.ts'

const silent = { confirmed: new Set<string>() }

describe('cross-source classification', () => {
  it('treats the first turn as establishing the owner, not as a crossing', () => {
    expect(classifySourceChange(undefined, 'claude', silent)).toEqual({ kind: 'first-turn', source: 'claude' })
  })

  it('says nothing when the source is unchanged', () => {
    expect(classifySourceChange('claude', 'claude', silent)).toEqual({ kind: 'same-source' })
  })

  it('says nothing for the platform as well, since it is one source', () => {
    expect(classifySourceChange(PLATFORM_SOURCE, PLATFORM_SOURCE, silent)).toEqual({ kind: 'same-source' })
  })

  it('asks before the first crossing between two sources', () => {
    expect(classifySourceChange(PLATFORM_SOURCE, 'claude', silent)).toEqual({
      kind: 'needs-confirmation',
      from: PLATFORM_SOURCE,
      to: 'claude',
    })
  })

  it('remembers a confirmed crossing so the same pair asks only once', () => {
    const memory = { confirmed: new Set([crossingKey(PLATFORM_SOURCE, 'claude')]) }
    expect(classifySourceChange(PLATFORM_SOURCE, 'claude', memory)).toEqual({
      kind: 'confirmed',
      from: PLATFORM_SOURCE,
      to: 'claude',
    })
  })

  it('still asks for a different target, because the pair is what was confirmed', () => {
    const memory = { confirmed: new Set([crossingKey(PLATFORM_SOURCE, 'claude')]) }
    expect(classifySourceChange(PLATFORM_SOURCE, 'codex', memory).kind).toBe('needs-confirmation')
  })

  it('treats each direction as its own pair', () => {
    const memory = { confirmed: new Set([crossingKey(PLATFORM_SOURCE, 'claude')]) }
    expect(classifySourceChange('claude', PLATFORM_SOURCE, memory).kind).toBe('needs-confirmation')
  })
})

describe('cross-source warning', () => {
  it('states the three facts that make the crossing consequential', () => {
    const warning = warningFor({ kind: 'needs-confirmation', from: 'claude', to: 'codex' })
    expect(warning).toEqual({
      from: 'claude',
      to: 'codex',
      rebuildsSession: true,
      flattensHistory: true,
      hidesPreviousTools: true,
    })
  })

  it('has nothing to warn about when no confirmation is needed', () => {
    expect(warningFor({ kind: 'same-source' })).toBeUndefined()
    expect(warningFor({ kind: 'first-turn', source: 'claude' })).toBeUndefined()
    expect(warningFor({ kind: 'confirmed', from: 'a', to: 'b' })).toBeUndefined()
  })
})

describe('approval outcomes', () => {
  it('proceeds without a note when the user allowed the crossing', () => {
    expect(decideFromApproval('allowed-once')).toEqual({ proceed: true, notifyOnly: false })
  })

  it('does not proceed when the user refused', () => {
    expect(decideFromApproval('rejected')).toEqual({ proceed: false, notifyOnly: false })
  })

  it('proceeds with a note when no approval surface exists', () => {
    // Refusing would make the feature unfireable on headless hosts.
    expect(decideFromApproval('unavailable')).toEqual({ proceed: true, notifyOnly: true })
  })

  it('proceeds with a note when the surface closed without an answer', () => {
    // A permissive session auto-rejects approvals; treating that as the user's refusal would
    // make every crossing fail silently in exactly that configuration.
    expect(decideFromApproval('cancelled')).toEqual({ proceed: true, notifyOnly: true })
  })
})
