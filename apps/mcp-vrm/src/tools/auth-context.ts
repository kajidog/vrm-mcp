import type { ToolHandlerExtra } from './types.js'

export const ANONYMOUS_USER_ID = 'anonymous'

const sessionUsers = new Map<string, string>()

export function resolveUserId(extra?: ToolHandlerExtra): string {
  const authenticatedUserId = resolveAuthenticatedUserId(extra)
  if (authenticatedUserId) {
    bindSessionUser(extra?.sessionId, authenticatedUserId)
    return authenticatedUserId
  }

  const sessionUserId = getSessionUser(extra?.sessionId)
  if (sessionUserId) return sessionUserId

  return ANONYMOUS_USER_ID
}

export function bindSessionUser(sessionId: string | undefined, userId: string | undefined): void {
  if (!sessionId || !userId) return
  const normalized = userId.trim()
  if (!normalized) return
  sessionUsers.set(sessionId, normalized)
}

export function bindSessionAuth(extra?: ToolHandlerExtra): void {
  bindSessionUser(extra?.sessionId, resolveAuthenticatedUserId(extra))
}

export function forgetSessionUser(sessionId: string | undefined): void {
  if (!sessionId) return
  sessionUsers.delete(sessionId)
}

function getSessionUser(sessionId: string | undefined): string | undefined {
  if (!sessionId) return undefined
  return sessionUsers.get(sessionId)
}

function resolveAuthenticatedUserId(extra?: ToolHandlerExtra): string | undefined {
  const sub = extra?.authInfo?.extra?.sub
  if (typeof sub === 'string' && sub.trim()) return sub.trim()

  const clientId = extra?.authInfo?.clientId
  if (typeof clientId === 'string' && clientId.trim() && clientId !== 'unknown') return clientId.trim()

  return undefined
}
