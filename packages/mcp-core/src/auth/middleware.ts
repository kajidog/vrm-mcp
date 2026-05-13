import type { Context, MiddlewareHandler } from 'hono'
import type { OAuthConfig } from './config.js'
import { getProtectedResourceMetadataUrl } from './metadata.js'
import { verifyAccessToken } from './tokenVerifier.js'

export interface AuthVariables {
  auth?: Awaited<ReturnType<typeof verifyAccessToken>>
}

function quoteAuthParam(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function createAuthenticateHeader(config: OAuthConfig, params: Record<string, string> = {}): string {
  const metadataUrl = getProtectedResourceMetadataUrl(config)
  const authParams = {
    realm: config.resourceName,
    resource_metadata: metadataUrl,
    ...params,
  }

  return `Bearer ${Object.entries(authParams)
    .map(([key, value]) => `${key}=${quoteAuthParam(value)}`)
    .join(', ')}`
}

/**
 * Hono middleware for JWT Bearer authentication
 */
export function bearerAuth(config: OAuthConfig, requiredScopes: string[] = []): MiddlewareHandler {
  return async (c: Context<{ Variables: AuthVariables }>, next) => {
    if (c.req.method === 'OPTIONS') {
      return next()
    }

    const authHeader = c.req.header('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      c.header('WWW-Authenticate', createAuthenticateHeader(config))
      return c.text('Unauthorized', 401)
    }

    const token = authHeader.slice('Bearer '.length).trim()

    try {
      const authInfo = await verifyAccessToken(token, config.jwksUri, config.issuer, config.audience, requiredScopes)
      // Store auth info in context for downstream handlers
      c.set('auth', authInfo)
      await next()
    } catch (error) {
      console.error('Token verification failed:', error)
      c.header('WWW-Authenticate', createAuthenticateHeader(config, { error: 'invalid_token' }))
      return c.text('Unauthorized', 401)
    }
  }
}
