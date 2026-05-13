# MCP Web Auth

MCP サーバーの OAuth 認証用ログイン画面です。Supabase Auth またはローカル開発用認証サーバーを使用できます。

## セットアップ

### 1. 環境変数を設定

```bash
cp .env.example .env
```

### 2. モードを選択

#### Supabase モード（本番用）

Supabase Dashboard で次を設定します。

1. Authentication > URL Configuration にこの web auth UI の URL を追加する。
   - 開発: `http://localhost:5173`
   - 本番: `https://your-auth.example.com`
2. Authentication > Sign In / Providers で使うログイン方法を有効化する。
3. Project Settings > API Keys で Project URL と publishable key、または legacy anon key を確認する。
4. JWT signing keys が JWKS で検証できる非対称鍵になっていることを確認する。

```bash
# .env
VITE_AUTH_MODE=supabase
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

GitHub provider を使う場合は、GitHub OAuth App の Authorization callback URL に Supabase が表示する callback URL を設定します。通常は次の形式です。

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

MCP サーバー側の Supabase 設定や GitHub provider の詳細手順は [../../docs/auth-setup.md](../../docs/auth-setup.md) を参照してください。

#### ローカルモード（開発用）

```bash
# .env
VITE_AUTH_MODE=local
VITE_LOCAL_AUTH_SERVER=http://localhost:3001
```

## 開発

### Supabase モード

```bash
pnpm dev
```

### ローカルモード

2つのターミナルで実行:

```bash
# ターミナル 1: ローカル認証サーバー（ポート 3001）
pnpm dev:auth

# ターミナル 2: ログイン画面（ポート 5173）
pnpm dev
```

ブラウザで http://localhost:5173 を開く。

ローカル認証サーバーは JWT を発行し、`/.well-known/jwks.json` と `/.well-known/oauth-authorization-server` を公開します。VRM MCP サーバー側は以下の設定で接続できます:

```bash
MCP_OAUTH_ENABLED=true
MCP_AUTH_SERVER_URL=http://localhost:3001
MCP_JWKS_URI=http://localhost:3001/.well-known/jwks.json
MCP_OAUTH_AUDIENCE=http://localhost:3000
MCP_RESOURCE_NAME="VRM MCP Server"
```

## ビルド

```bash
pnpm build
```

`dist/` フォルダが生成されます。

## GitHub Pages デプロイ

1. GitHub リポジトリの Settings > Pages で Source を "GitHub Actions" に設定
2. `dist/` フォルダを gh-pages ブランチにプッシュ

`/oauth/consent` への直リンクは GitHub Pages の SPA fallback 用 `404.html` で `/vrm-mcp/?p=/oauth/consent` に戻します。Supabase の Authentication > URL Configuration には、Site URL に加えて次を Redirect URL として許可してください。

```text
https://kajidog.github.io/vrm-mcp/**
```

## 使い方

MCP クライアントからこの認証画面にリダイレクトします:

```
https://your-auth-page.github.io/?redirect_uri=YOUR_CALLBACK_URL&state=RANDOM_STATE
```

ログイン成功後、以下のパラメータ付きで `redirect_uri` にリダイレクトされます:

| パラメータ | 説明 |
|-----------|------|
| `access_token` | JWT アクセストークン |
| `token_type` | "bearer" |
| `expires_in` | 有効期限（秒） |
| `state` | 元のリクエストの state 値 |

## ファイル構成

```
apps/web-auth/
├── src/
│   ├── App.tsx          # ログイン画面 + コールバック処理
│   ├── main.tsx         # エントリーポイント
│   ├── supabase.ts      # Supabase/ローカルモード設定
│   └── vite-env.d.ts    # 型定義
├── scripts/
│   └── dev-auth-server.js  # ローカル開発用認証サーバー
├── index.html
├── vite.config.ts
├── .env.example
└── README.md
```
