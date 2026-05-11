import type { CreateHttpAppOptions, OAuthConfig } from '@kajidog/mcp-core'

export const VRM_AUTH_PROTECTED_ROUTES = ['/mcp', '/vrms/:fileName', '/poses/:fileName'] as const

export function createVrmOAuthHttpOptions(
  authConfig: OAuthConfig | null
): Pick<CreateHttpAppOptions, 'authConfig' | 'authProtectedRoutes' | 'authRequiredScopes'> {
  return {
    authConfig,
    authProtectedRoutes: authConfig ? [...VRM_AUTH_PROTECTED_ROUTES] : [],
    authRequiredScopes: authConfig
      ? {
          '/mcp': ['mcp:tools'],
          '/vrms/:fileName': ['mcp:resources'],
          '/poses/:fileName': ['mcp:resources'],
        }
      : {},
  }
}
