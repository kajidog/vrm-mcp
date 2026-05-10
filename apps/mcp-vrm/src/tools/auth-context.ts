import type { ToolHandlerExtra } from './types.js'

export const ANONYMOUS_USER_ID = 'anonymous'

export function resolveUserId(extra?: ToolHandlerExtra): string {
  const sub = extra?.authInfo?.extra?.sub
  if (typeof sub === 'string' && sub.trim()) return sub.trim()

  const clientId = extra?.authInfo?.clientId
  if (typeof clientId === 'string' && clientId.trim() && clientId !== 'unknown') return clientId.trim()

  return ANONYMOUS_USER_ID
}
