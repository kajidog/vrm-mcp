import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isLocalMode, localAuthServerUrl, supabase, supabaseAnonKey, supabaseUrl } from './supabase'

interface AuthorizationDetails {
  authorization_id?: string
  client?: {
    id?: string
    client_id?: string
    name?: string
  }
  redirect_uri?: string
  scope?: string
  scopes?: string[]
  redirect_url?: string
}

interface AuthorizationRedirect {
  redirect_url?: string
  redirect_to?: string
}

function getRoutePath(): string {
  const params = new URLSearchParams(window.location.search)
  const redirectedPath = params.get('p')
  if (redirectedPath) return redirectedPath

  const basePath = new URL(import.meta.env.BASE_URL || '/', window.location.origin).pathname
  const path = window.location.pathname
  if (basePath !== '/' && path.startsWith(basePath)) {
    return `/${path.slice(basePath.length).replace(/^\/+/, '')}`
  }
  return path
}

async function getSessionAccessToken(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()
  if (error) throw error
  if (!session?.access_token) throw new Error('ログインセッションが見つかりません。')
  return session.access_token
}

async function requestOAuthServer<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const accessToken = await getSessionAccessToken()
  const response = await fetch(`${supabaseUrl}/auth/v1${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || 'OAuth request failed'
    throw new Error(message)
  }
  return data as T
}

function getRedirectUrl(data: AuthorizationRedirect): string | undefined {
  return data.redirect_url || data.redirect_to
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [redirectUri, setRedirectUri] = useState<string | null>(null)
  const [state, setState] = useState<string | null>(null)
  const [authorizationDetails, setAuthorizationDetails] = useState<AuthorizationDetails | null>(null)
  const [consentLoading, setConsentLoading] = useState(false)
  const [consentError, setConsentError] = useState<string | null>(null)
  const [decisionLoading, setDecisionLoading] = useState(false)
  const localCallbackHandledRef = useRef(false)

  const params = new URLSearchParams(window.location.search)
  const routePath = getRoutePath()
  const isConsentRoute = routePath === '/oauth/consent'
  const authorizationId = params.get('authorization_id')

  useEffect(() => {
    // URL パラメータから redirect_uri と state を取得
    const params = new URLSearchParams(window.location.search)
    const uri = params.get('redirect_uri')
    const stateParam = params.get('state')

    if (uri) {
      setRedirectUri(uri)
      setState(stateParam)
      sessionStorage.setItem('oauth_redirect_uri', uri)
      if (stateParam) {
        sessionStorage.setItem('oauth_state', stateParam)
      }
    } else {
      const storedUri = sessionStorage.getItem('oauth_redirect_uri')
      const storedState = sessionStorage.getItem('oauth_state')
      if (storedUri) {
        setRedirectUri(storedUri)
        setState(storedState)
      }
    }

    // ローカルモードの場合は Supabase セッションチェックをスキップ
    if (isLocalMode) {
      setLoading(false)
      return
    }

    // Supabase セッション状態を監視
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const redirectWithToken = useCallback(
    (accessToken: string, expiresIn: number) => {
      const targetRedirectUri = redirectUri || sessionStorage.getItem('oauth_redirect_uri')
      const targetState = state || sessionStorage.getItem('oauth_state')

      if (targetRedirectUri) {
        const url = new URL(targetRedirectUri)
        url.searchParams.set('access_token', accessToken)
        url.searchParams.set('token_type', 'bearer')
        url.searchParams.set('expires_in', String(expiresIn))
        if (targetState) {
          url.searchParams.set('state', targetState)
        }

        sessionStorage.removeItem('oauth_redirect_uri')
        sessionStorage.removeItem('oauth_state')

        window.location.href = url.toString()
      }
    },
    [redirectUri, state]
  )

  // Supabase ログイン成功後、リダイレクト
  useEffect(() => {
    if (!isLocalMode && session && redirectUri) {
      redirectWithToken(session.access_token, session.expires_in || 3600)
    }
  }, [session, redirectUri, redirectWithToken])

  useEffect(() => {
    if (isLocalMode || !isConsentRoute || !authorizationId || !session) return

    let cancelled = false
    setConsentLoading(true)
    setConsentError(null)
    setAuthorizationDetails(null)

    requestOAuthServer<AuthorizationDetails>(`/oauth/authorizations/${authorizationId}`)
      .then((data) => {
        if (cancelled) return
        const redirectUrl = getRedirectUrl(data)
        if (redirectUrl && !data.authorization_id) {
          window.location.assign(redirectUrl)
          return
        }
        setAuthorizationDetails(data)
      })
      .catch((error) => {
        if (!cancelled) setConsentError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setConsentLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [authorizationId, isConsentRoute, session])

  const handleConsentDecision = async (action: 'approve' | 'deny') => {
    if (!authorizationId) return
    try {
      setDecisionLoading(true)
      setConsentError(null)
      const data = await requestOAuthServer<AuthorizationRedirect>(`/oauth/authorizations/${authorizationId}/consent`, {
        method: 'POST',
        body: { action },
      })
      const redirectUrl = getRedirectUrl(data)
      if (!redirectUrl) throw new Error('OAuth redirect URL が返されませんでした。')
      window.location.assign(redirectUrl)
    } catch (error) {
      setConsentError(error instanceof Error ? error.message : String(error))
      setDecisionLoading(false)
    }
  }

  // ローカルモード: ダミーログイン
  const handleLocalLogin = async () => {
    try {
      setLoading(true)

      // auth-server.js の /authorize エンドポイントを呼び出し
      // 実際には PKCE フローを使うべきだが、デモ用に簡略化
      const callbackUrl = `${window.location.origin + window.location.pathname}?local_callback=1`
      const authUrl = `${localAuthServerUrl}/authorize?${new URLSearchParams({
        client_id: 'demo-client',
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: 'openid email profile',
        state: state || 'demo',
      })}`

      window.location.href = authUrl
    } catch (error) {
      console.error('Local login error:', error)
      setLoading(false)
    }
  }

  // ローカルコールバック処理
  useEffect(() => {
    if (localCallbackHandledRef.current) return

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const isLocalCallback = params.get('local_callback')

    if (isLocalMode && code && isLocalCallback) {
      localCallbackHandledRef.current = true
      // 認可コードをトークンに交換
      fetch(`${localAuthServerUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: 'demo-verifier',
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.access_token) {
            redirectWithToken(data.access_token, data.expires_in || 3600)
          }
        })
        .catch(console.error)
    }
  }, [redirectWithToken])

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.loading}>Loading...</p>
        </div>
      </div>
    )
  }

  if (!isLocalMode && isConsentRoute) {
    if (!authorizationId) {
      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <h1 style={styles.title}>OAuth Error</h1>
            <p style={styles.text}>authorization_id がありません。</p>
          </div>
        </div>
      )
    }

    if (!session) {
      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <h1 style={styles.title}>VRM MCP Auth</h1>
            <p style={styles.subtitle}>ログインして ChatGPT からの接続を承認してください。</p>
            <Auth
              supabaseClient={supabase}
              appearance={{
                theme: ThemeSupa,
                variables: {
                  default: {
                    colors: {
                      brand: '#667eea',
                      brandAccent: '#764ba2',
                    },
                  },
                },
              }}
              providers={['github']}
              redirectTo={window.location.href}
            />
          </div>
        </div>
      )
    }

    const scopes = authorizationDetails?.scope
      ? authorizationDetails.scope.split(' ').filter(Boolean)
      : authorizationDetails?.scopes || []

    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>接続を承認</h1>
          {consentLoading ? (
            <p style={styles.loading}>Loading...</p>
          ) : (
            <>
              {consentError && <p style={styles.error}>{consentError}</p>}
              <p style={styles.text}>
                {authorizationDetails?.client?.name || 'ChatGPT'} が VRM MCP Server へのアクセスを要求しています。
              </p>
              {authorizationDetails?.redirect_uri && (
                <p style={styles.info}>
                  <strong>Redirect URI:</strong> {authorizationDetails.redirect_uri}
                </p>
              )}
              {scopes.length > 0 && (
                <div style={styles.scopeList}>
                  {scopes.map((scope) => (
                    <span key={scope} style={styles.scopeBadge}>
                      {scope}
                    </span>
                  ))}
                </div>
              )}
              <div style={styles.buttonRow}>
                <button
                  type="button"
                  style={{ ...styles.button, ...styles.secondaryButton }}
                  disabled={decisionLoading}
                  onClick={() => handleConsentDecision('deny')}
                >
                  拒否
                </button>
                <button
                  type="button"
                  style={styles.button}
                  disabled={decisionLoading || !authorizationDetails}
                  onClick={() => handleConsentDecision('approve')}
                >
                  承認
                </button>
              </div>
              <button type="button" style={styles.linkButton} onClick={() => supabase.auth.signOut()}>
                別のアカウントでログイン
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // 既にログイン済みだがリダイレクト先がない場合
  if (!isLocalMode && session && !redirectUri) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>✅ ログイン済み</h1>
          <p style={styles.text}>{session.user.email}</p>
          <p style={styles.tokenBox}>
            <strong>Access Token:</strong>
            <br />
            <code style={styles.code}>{session.access_token.substring(0, 50)}...</code>
          </p>
          <button type="button" style={styles.button} onClick={() => supabase.auth.signOut()}>
            ログアウト
          </button>
        </div>
      </div>
    )
  }

  // ローカルモード
  if (isLocalMode) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>🔐 MCP Auth (Local)</h1>
          <p style={styles.subtitle}>ローカル開発用認証サーバーを使用しています</p>
          <p style={styles.info}>
            <strong>Auth Server:</strong> {localAuthServerUrl}
          </p>
          {redirectUri && (
            <p style={styles.info}>
              <strong>Redirect to:</strong> {redirectUri}
            </p>
          )}
          <button type="button" style={styles.button} onClick={handleLocalLogin}>
            🚀 ログイン (デモユーザー)
          </button>
          <p style={styles.hint}>※ 開発用のダミー認証です。本番では Supabase を使用してください。</p>
        </div>
      </div>
    )
  }

  // Supabase モード
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>VRM MCP Auth</h1>
        <Auth
          supabaseClient={supabase}
          appearance={{
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: '#667eea',
                  brandAccent: '#764ba2',
                },
              },
            },
          }}
          providers={['github']}
          redirectTo={window.location.origin + window.location.pathname}
          localization={{
            variables: {
              sign_in: {
                email_label: 'メールアドレス',
                password_label: 'パスワード',
                button_label: 'ログイン',
              },
              sign_up: {
                email_label: 'メールアドレス',
                password_label: 'パスワード',
              },
            },
          }}
        />
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100%',
  },
  card: {
    background: 'rgba(255, 255, 255, 0.95)',
    borderRadius: '16px',
    padding: '32px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    width: '100%',
    maxWidth: '400px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: '8px',
    color: '#333',
  },
  subtitle: {
    fontSize: '14px',
    textAlign: 'center',
    marginBottom: '24px',
    color: '#666',
  },
  loading: {
    textAlign: 'center',
    color: '#666',
  },
  text: {
    textAlign: 'center',
    marginBottom: '16px',
    color: '#333',
  },
  tokenBox: {
    background: '#f5f5f5',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '12px',
    wordBreak: 'break-all',
  },
  code: {
    fontFamily: 'monospace',
    fontSize: '11px',
  },
  button: {
    width: '100%',
    padding: '12px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  info: {
    fontSize: '12px',
    color: '#666',
    marginBottom: '12px',
    wordBreak: 'break-all',
  },
  hint: {
    fontSize: '11px',
    color: '#999',
    textAlign: 'center',
    marginTop: '16px',
  },
  error: {
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: '8px',
    padding: '12px',
    fontSize: '13px',
    marginBottom: '16px',
    wordBreak: 'break-word',
  },
  scopeList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginBottom: '20px',
  },
  scopeBadge: {
    background: '#eef2ff',
    color: '#3730a3',
    borderRadius: '999px',
    padding: '6px 10px',
    fontSize: '12px',
    fontWeight: 600,
  },
  buttonRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
  },
  secondaryButton: {
    background: '#4b5563',
  },
  linkButton: {
    width: '100%',
    marginTop: '14px',
    background: 'transparent',
    border: 'none',
    color: '#4f46e5',
    cursor: 'pointer',
    fontSize: '13px',
  },
}

export default App
