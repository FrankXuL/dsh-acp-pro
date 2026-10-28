/**
 * The usage annotation copy.
 *
 * The numbers themselves need no work: ACP reports session totals, the adapter takes the
 * difference between two observations, and that already satisfies the token projection. What the
 * user needs is to know that the figure is derived rather than billed — which is what these
 * strings say, and what this test keeps them saying.
 */

import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales/index.ts'

const KEYS = ['usage.estimated', 'usage.estimatedDetail', 'usage.contextWindowEstimated'] as const

describe('usage annotations', () => {
  it('exists in both locales', () => {
    for (const key of KEYS) {
      expect(zh[key], `zh:${key}`).toBeTruthy()
      expect(en[key], `en:${key}`).toBeTruthy()
    }
  })

  it('says the figure is an estimate, so it is never read as a billed amount', () => {
    expect(zh['usage.estimated']).toContain('估算')
    expect(en['usage.estimated']).toContain('estimated')
  })

  it('explains where the number comes from rather than only labelling it', () => {
    // "estimated" alone invites the question "estimated how?"; the detail names the cause.
    expect(zh['usage.estimatedDetail']).toContain('会话级累计')
    expect(zh['usage.estimatedDetail']).toContain('差值')
    expect(en['usage.estimatedDetail']).toContain('session totals')
    expect(en['usage.estimatedDetail']).toContain('difference')
  })

  it('flags that the context window itself may be inferred', () => {
    expect(zh['usage.contextWindowEstimated']).toContain('上下文窗口')
    expect(en['usage.contextWindowEstimated']).toContain('context window')
  })

  it('states the limit explicitly instead of leaving it implied', () => {
    // The copy says "not a billed amount" rather than hedging: a reader should not have to infer
    // the precision from the word "estimate".
    expect(zh['usage.estimatedDetail']).toContain('不是账单级')
    expect(en['usage.estimatedDetail']).toContain('not a billed amount')
  })
})
