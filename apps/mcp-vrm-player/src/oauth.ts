import type { CreateHttpAppOptions, OAuthConfig } from '@kajidog/mcp-core'

export const VRM_AUTH_PROTECTED_ROUTES = ['/mcp'] as const

export function createVrmOAuthHttpOptions(
  authConfig: OAuthConfig | null
): Pick<CreateHttpAppOptions, 'authConfig' | 'authProtectedRoutes' | 'authRequiredScopes'> {
  return {
    authConfig,
    authProtectedRoutes: authConfig ? [...VRM_AUTH_PROTECTED_ROUTES] : [],
    authRequiredScopes: {},
  }
}
