import { describe, expect, it } from 'vitest'
import { ANONYMOUS_USER_ID, bindSessionAuth, forgetSessionUser, resolveUserId } from '../auth-context.js'
import type { ToolHandlerExtra } from '../types.js'

function authExtra(sessionId: string, sub: string): ToolHandlerExtra {
  return {
    sessionId,
    authInfo: {
      token: 'token',
      clientId: 'client-id',
      scopes: [],
      extra: { sub },
    },
  }
}

describe('auth context', () => {
  it('uses the authenticated subject and reuses it for app calls in the same session', () => {
    expect(resolveUserId(authExtra('session-a', 'user-a'))).toBe('user-a')
    expect(resolveUserId({ sessionId: 'session-a' })).toBe('user-a')
  })

  it('can bind and forget session auth explicitly', () => {
    bindSessionAuth(authExtra('session-b', 'user-b'))
    expect(resolveUserId({ sessionId: 'session-b' })).toBe('user-b')

    forgetSessionUser('session-b')
    expect(resolveUserId({ sessionId: 'session-b' })).toBe(ANONYMOUS_USER_ID)
  })
})
