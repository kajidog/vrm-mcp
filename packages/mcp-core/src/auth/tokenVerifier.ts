import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AuthInfo {
  token: string
  clientId: string
  scopes: string[]
  audience?: string | string[]
  expiresAt?: number
  extra?: Record<string, unknown>
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getRemoteJwkSet(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(jwksUri)
  if (cached) return cached

  const jwks = createRemoteJWKSet(new URL(jwksUri))
  jwksCache.set(jwksUri, jwks)
  return jwks
}

export async function verifyAccessToken(
  token: string,
  jwksUri: string,
  issuer?: string,
  audience?: string,
  requiredScopes: string[] = []
): Promise<AuthInfo> {
  const JWKS = getRemoteJwkSet(jwksUri)

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer,
      audience,
    })
    const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : []
    const missingScope = requiredScopes.find((scope) => !scopes.includes(scope))
    if (missingScope) {
      throw new Error(`Missing required scope: ${missingScope}`)
    }

    return {
      token,
      clientId: (payload.azp as string) || (payload.client_id as string) || 'unknown',
      scopes,
      audience: payload.aud,
      expiresAt: payload.exp,
      extra: {
        sub: payload.sub,
      },
    }
  } catch (error) {
    throw new Error(`Token verification failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
