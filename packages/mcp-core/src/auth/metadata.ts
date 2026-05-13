import type { OAuthConfig } from './config.js'

export function getProtectedResourceMetadataUrl(config: OAuthConfig): string {
  return new URL('/.well-known/oauth-protected-resource', config.mcpServerUrl).toString()
}

export function getProtectedResourceIdentifier(config: OAuthConfig): string {
  const url = new URL(config.mcpServerUrl)
  const path = url.pathname.replace(/\/+$/, '')
  if (path === '/mcp') return url.toString()

  return new URL('/mcp', url).toString()
}

export function createProtectedResourceMetadata(config: OAuthConfig) {
  return {
    resource: getProtectedResourceIdentifier(config),
    authorization_servers: [config.authServerUrl],
    jwks_uri: config.jwksUri,
    ...(config.issuer ? { issuer: config.issuer } : {}),
    scopes_supported: config.scopesSupported,
    bearer_methods_supported: ['header'],
    resource_documentation: `${config.resourceName} - MCP Server`,
  }
}
