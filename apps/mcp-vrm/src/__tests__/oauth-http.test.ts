import { describe, expect, it } from 'vitest'
import type { BaseServerConfig, OAuthConfig } from '../../../../packages/mcp-core/src/index.js'
import { createOAuthConfig } from '../../../../packages/mcp-core/src/index.js'
import { createHttpApp } from '../../../../packages/mcp-core/src/index.js'
import { VRM_AUTH_PROTECTED_ROUTES, createVrmOAuthHttpOptions } from '../oauth.js'

const baseConfig: BaseServerConfig = {
  httpMode: true,
  httpPort: 3000,
  httpHost: 'localhost',
  allowedHosts: ['localhost'],
  allowedOrigins: ['http://localhost'],
  oauthEnabled: false,
  mcpServerUrl: 'http://localhost:3000',
  oauthAuthServerUrl: 'http://localhost:3001',
  oauthScopes: ['openid', 'email', 'profile'],
}

const authConfig: OAuthConfig = {
  enabled: true,
  mcpServerUrl: 'http://localhost:3000',
  authServerUrl: 'http://localhost:3001',
  jwksUri: 'http://localhost:3001/.well-known/jwks.json',
  audience: 'http://localhost:3000',
  scopesSupported: ['openid', 'email', 'profile'],
  resourceName: 'VRM MCP Server',
}

const expectedWwwAuthenticate =
  'Bearer realm="VRM MCP Server", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"'

function createApp(options: Partial<Parameters<typeof createHttpApp>[0]> = {}) {
  return createHttpApp({
    server: {} as Parameters<typeof createHttpApp>[0]['server'],
    config: baseConfig,
    ...options,
  })
}

describe('OAuth HTTP auth', () => {
  it('OAuth 無効時は既存の API キー認証を維持する', async () => {
    const app = createApp({
      config: { ...baseConfig, apiKey: 'secret' },
    })

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { Host: 'localhost', 'Content-Type': 'application/json' },
      body: '{}',
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { message: 'Unauthorized: Invalid API key' },
    })
  })

  it('OAuth 有効時は保護対象ルートで Bearer token を要求する', async () => {
    const app = createApp({
      authConfig,
      authProtectedRoutes: ['/mcp'],
    })

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { Host: 'localhost', 'Content-Type': 'application/json' },
      body: '{}',
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe(expectedWwwAuthenticate)
    await expect(response.text()).resolves.toBe('Unauthorized')
  })

  it('OAuth 有効時も未保護ルートは認証不要で通る', async () => {
    const app = createApp({
      authConfig,
      authProtectedRoutes: ['/protected'],
      configureApp: (hono) => {
        hono.get('/public', (c) => c.text('ok'))
      },
    })

    const response = await app.request('/public', {
      headers: { Host: 'localhost' },
    })

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('ok')
  })

  it('core は渡されたアプリ固有パスパターンをそのまま保護する', async () => {
    const app = createApp({
      authConfig,
      authProtectedRoutes: ['/tenant/:id'],
      configureApp: (hono) => {
        hono.get('/tenant/:id', (c) => c.text(c.req.param('id')))
      },
    })

    const response = await app.request('/tenant/example', {
      headers: { Host: 'localhost' },
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe(expectedWwwAuthenticate)
  })

  it('OAuth 有効時は MCP_API_KEY 相当の API キーでは /mcp を通さない', async () => {
    const app = createApp({
      config: { ...baseConfig, apiKey: 'secret' },
      authConfig,
      authProtectedRoutes: ['/mcp'],
    })

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        Host: 'localhost',
        'Content-Type': 'application/json',
        'X-API-Key': 'secret',
      },
      body: '{}',
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe(expectedWwwAuthenticate)
    await expect(response.text()).resolves.toBe('Unauthorized')
  })

  it('protected resource metadata は認証不要で返る', async () => {
    const app = createApp({
      authConfig,
      authProtectedRoutes: ['/mcp'],
    })

    const response = await app.request('/.well-known/oauth-protected-resource', {
      headers: { Host: 'localhost' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      resource: 'http://localhost:3000/mcp',
      authorization_servers: ['http://localhost:3001'],
      jwks_uri: 'http://localhost:3001/.well-known/jwks.json',
      scopes_supported: ['openid', 'email', 'profile'],
    })
  })

  it('path-specific protected resource metadata も認証不要で返る', async () => {
    const app = createApp({
      authConfig,
      authProtectedRoutes: ['/mcp'],
    })

    const response = await app.request('/.well-known/oauth-protected-resource/mcp', {
      headers: { Host: 'localhost' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      resource: 'http://localhost:3000/mcp',
      authorization_servers: ['http://localhost:3001'],
    })
  })
})

describe('VRM OAuth HTTP options', () => {
  it('VRM 固有の resource name はアプリ側デフォルトから作る', () => {
    expect(createOAuthConfig({ ...baseConfig, oauthEnabled: true }, { resourceName: 'VRM MCP Server' })).toEqual(
      authConfig
    )
  })

  it('/mcp を保護対象として渡す', () => {
    expect(createVrmOAuthHttpOptions(authConfig)).toEqual({
      authConfig,
      authProtectedRoutes: [...VRM_AUTH_PROTECTED_ROUTES],
      authRequiredScopes: {},
    })
  })

  it('OAuth 無効時は保護対象ルートを渡さない', () => {
    expect(createVrmOAuthHttpOptions(null)).toEqual({
      authConfig: null,
      authProtectedRoutes: [],
      authRequiredScopes: {},
    })
  })
})
