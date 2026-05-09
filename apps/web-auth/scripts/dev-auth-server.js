import crypto from 'node:crypto'
import http from 'node:http'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'

const PORT = process.env.PORT || 3001
const HOST = 'localhost'
const ISSUER = process.env.MCP_AUTH_SERVER_URL || `http://${HOST}:${PORT}`
const RESOURCE_NAME = process.env.MCP_RESOURCE_NAME || 'VRM MCP Server'

// Store for codes
const codes = new Map()

// Generate keys for signing
let privateKey
let publicKey
let jwk

async function setupKeys() {
  const { privateKey: priv, publicKey: pub } = await generateKeyPair('RS256')
  privateKey = priv
  publicKey = pub
  jwk = await exportJWK(pub)
  jwk.use = 'sig'
  jwk.alg = 'RS256'
  jwk.kid = 'dev-key-1' // Key ID
}

function generateId() {
  return crypto.randomBytes(16).toString('hex')
}

// S256 Code Challenge Verification
function verifyCodeChallenge(verifier, challenge) {
  if (!verifier || !challenge) return true
  const hash = crypto.createHash('sha256').update(verifier).digest()
  const computedChallenge = hash.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return computedChallenge === challenge
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`)
  const pathname = parsedUrl.pathname

  const readBody = () =>
    new Promise((resolve) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => resolve(body))
    })

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // 1. Authorize Endpoint
  if (req.method === 'GET' && pathname === '/authorize') {
    const query = Object.fromEntries(parsedUrl.searchParams)
    const code = generateId()
    codes.set(code, {
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      scope: query.scope,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      state: query.state,
      createdAt: Date.now(),
    })

    console.log('[Auth] Authorize request', query)
    console.log(`[Auth] Generated code: ${code}`)

    const redirectUrl = new URL(query.redirect_uri)
    redirectUrl.searchParams.set('code', code)
    if (query.state) redirectUrl.searchParams.set('state', query.state)

    res.writeHead(302, { Location: redirectUrl.toString() })
    res.end()
    return
  }

  // 2. Token Endpoint (Returns JWT)
  if (req.method === 'POST' && pathname === '/token') {
    const bodyString = await readBody()
    const params = new URLSearchParams(bodyString)
    const grantType = params.get('grant_type')
    const code = params.get('code')
    const verifier = params.get('code_verifier')

    console.log(`[Auth] Token request: grant_type=${grantType}, code=${code}`)

    if (grantType === 'authorization_code') {
      const authData = codes.get(code)
      if (!authData) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_grant' }))
        return
      }

      if (authData.codeChallenge && !verifyCodeChallenge(verifier, authData.codeChallenge)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE verification failed' }))
        return
      }

      codes.delete(code)

      // Generate JWT
      const jwt = await new SignJWT({
        scope: authData.scope,
        azp: authData.clientId, // Authorized party
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'dev-key-1' })
        .setIssuedAt()
        .setIssuer(ISSUER)
        .setAudience(RESOURCE_NAME)
        .setExpirationTime('1h')
        .sign(privateKey)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          access_token: jwt,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: authData.scope,
        })
      )
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'unsupported_grant_type' }))
    }
    return
  }

  // 3. JWKS Endpoint (New!)
  if (req.method === 'GET' && pathname === '/.well-known/jwks.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ keys: [jwk] }))
    return
  }

  // 4. Metadata Endpoint
  if (req.method === 'GET' && pathname === '/.well-known/oauth-authorization-server') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        scopes_supported: ['mcp:tools', 'mcp:resources'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
        code_challenge_methods_supported: ['S256'],
      })
    )
    return
  }

  res.writeHead(404)
  res.end('Not Found')
})

setupKeys().then(() => {
  server.listen(PORT, () => {
    console.log(`Dev JWT Auth Server running at http://${HOST}:${PORT}`)
    console.log(`- Authorize: http://${HOST}:${PORT}/authorize`)
    console.log(`- Token:     http://${HOST}:${PORT}/token`)
    console.log(`- JWKS:      http://${HOST}:${PORT}/.well-known/jwks.json`)
    console.log(`- Metadata:  http://${HOST}:${PORT}/.well-known/oauth-authorization-server`)
  })
})
