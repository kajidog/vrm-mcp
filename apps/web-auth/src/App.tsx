import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isLocalMode, localAuthServerUrl, supabase } from './supabase'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [redirectUri, setRedirectUri] = useState<string | null>(null)
  const [state, setState] = useState<string | null>(null)
  const localCallbackHandledRef = useRef(false)

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
        scope: 'mcp:tools mcp:resources',
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
}

export default App
