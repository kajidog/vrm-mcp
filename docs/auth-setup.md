# OAuth 認証セットアップ

VRM MCP サーバーは HTTP モードで OAuth JWT Bearer 認証を有効化できます。認証を有効にすると `/mcp`, `/vrms/:fileName`, `/poses/:fileName` が `Authorization: Bearer <JWT>` 必須になります。`/health` と `/.well-known/oauth-protected-resource` は認証不要です。

認証後は、VRM モデル・カスタムポーズ・プレイヤー設定がユーザーごとに分離されます。VRM は登録者が公開すると他ユーザーも利用できますが、編集・削除は登録者のみ可能です。公開 VRM を利用するかどうかはプレイヤー設定でユーザーごとに切り替えできます。

## ローカル開発

ローカルでは `apps/web-auth` の開発用認証サーバーを使えます。3 つのターミナルで起動します。

```bash
pnpm --filter @kajidog/mcp-web-auth dev:auth
```

```bash
pnpm --filter @kajidog/mcp-web-auth dev
```

```bash
MCP_HTTP_MODE=true \
MCP_OAUTH_ENABLED=true \
MCP_SERVER_URL=http://localhost:3000 \
MCP_AUTH_SERVER_URL=http://localhost:3001 \
MCP_JWKS_URI=http://localhost:3001/.well-known/jwks.json \
MCP_ISSUER=http://localhost:3001 \
MCP_RESOURCE_NAME="VRM MCP Server" \
pnpm --filter @kajidog/vrm-mcp dev
```

`apps/web-auth` をローカルモードで使う場合は、`apps/web-auth/.env` を次のように設定します。

```env
VITE_AUTH_MODE=local
VITE_LOCAL_AUTH_SERVER=http://localhost:3001
```

開発用認証サーバーは起動ごとに一時的な署名鍵を生成します。本番用途には使わないでください。

## Supabase を使う場合

Supabase Auth のアクセストークンを MCP サーバーで検証するには、JWKS で検証可能な非対称 JWT signing keys を使います。Supabase の JWKS URL は通常、次の形式です。

```text
https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
```

Supabase 側で行うこと:

1. Supabase プロジェクトを作成する。
2. Authentication の providers で GitHub、Google、Email など必要なログイン方法を有効化する。
3. Authentication の URL/Redirect URL 設定に web auth UI の URL を追加する。
   - 開発例: `http://localhost:5173`
   - 本番例: `https://your-auth.example.com`
4. JWT signing keys が JWKS で検証できる非対称鍵になっていることを確認する。
5. `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を `apps/web-auth/.env` に設定する。

<details>
<summary>GitHub provider を使う場合</summary>

Supabase の GitHub provider は、GitHub OAuth App で発行した Client ID / Client Secret を Supabase に登録して使います。GitHub 側の callback URL は web auth UI の URL ではなく、Supabase Auth の callback URL です。

1. Supabase Dashboard で対象プロジェクトを開く。
2. Authentication > Sign In / Providers を開き、GitHub provider を展開する。
3. 表示されている Callback URL をコピーする。通常は次の形式です。

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

4. GitHub の Developer settings > OAuth Apps を開く。
5. New OAuth App または Register a new application を選ぶ。
6. GitHub OAuth App を次の内容で作成する。
   - Application name: 任意の名前。例: `VRM MCP Auth`
   - Homepage URL: web auth UI の URL。開発なら `http://localhost:5173`、本番なら `https://your-auth.example.com`
   - Authorization callback URL: 手順 3 でコピーした Supabase の callback URL
   - Enable Device Flow: 無効のままでよい
7. 作成後、GitHub OAuth App の Client ID をコピーする。
8. Generate a new client secret で Client Secret を作成してコピーする。
9. Supabase Dashboard に戻り、Authentication > Sign In / Providers > GitHub を開く。
10. GitHub provider を Enabled にし、Client ID と Client Secret を入力して保存する。
11. Authentication > URL Configuration で web auth UI の URL を許可する。
    - Site URL: 本番の web auth UI URL。開発だけなら `http://localhost:5173`
    - Redirect URLs: `http://localhost:5173` と本番 URL を必要に応じて追加

ローカルの Supabase CLI を使って GitHub OAuth を試す場合は、GitHub OAuth App の Authorization callback URL に `http://localhost:54321/auth/v1/callback` も使います。Hosted Supabase を使う場合は `https://<project-ref>.supabase.co/auth/v1/callback` を設定してください。

</details>


`apps/web-auth/.env` の例:

```env
VITE_AUTH_MODE=supabase
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

MCP サーバー側の例:

```bash
MCP_HTTP_MODE=true \
MCP_OAUTH_ENABLED=true \
MCP_SERVER_URL=https://your-mcp.example.com \
MCP_AUTH_SERVER_URL=https://<project-ref>.supabase.co/auth/v1 \
MCP_JWKS_URI=https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json \
MCP_ISSUER=https://<project-ref>.supabase.co/auth/v1 \
MCP_RESOURCE_NAME="VRM MCP Server" \
pnpm --filter @kajidog/vrm-mcp start:http
```

`MCP_ISSUER` は指定した場合だけ JWT の `iss` を検証します。Supabase プロジェクトの実際の issuer と一致しない場合は 401 になります。


## 環境変数

| 変数 | 説明 | 既定値 |
| --- | --- | --- |
| `MCP_HTTP_MODE` | HTTP モードを有効化します。OAuth 認証は HTTP モードのみ対象です。 | `false` |
| `MCP_OAUTH_ENABLED` | OAuth JWT Bearer 認証を有効化します。 | `false` |
| `MCP_SERVER_URL` | MCP サーバー自身の公開 URL。protected resource metadata の `resource` に使います。 | `http://localhost:3000` |
| `MCP_AUTH_SERVER_URL` | 認可サーバー URL。protected resource metadata の `authorization_servers` に使います。 | `http://localhost:3001` |
| `MCP_JWKS_URI` | JWT 署名検証用の JWKS URL。未指定時は `${MCP_AUTH_SERVER_URL}/.well-known/jwks.json`。 | 未指定 |
| `MCP_ISSUER` | JWT の `iss` 検証値。未指定なら issuer 検証を行いません。 | 未指定 |
| `MCP_OAUTH_SCOPES` | metadata で公開するスコープ。カンマ区切りで指定します。 | `mcp:tools,mcp:resources` |
| `MCP_RESOURCE_NAME` | `WWW-Authenticate` realm と metadata の表示名。 | `VRM MCP Server` |

OAuth 有効時は `MCP_API_KEY` より OAuth JWT を優先します。OAuth 無効時は既存どおり `MCP_API_KEY` による認証を利用できます。

## 確認方法

metadata が公開されていることを確認します。

```bash
curl http://localhost:3000/.well-known/oauth-protected-resource
```

認証なしの `/mcp` は 401 になります。

```bash
curl -i http://localhost:3000/mcp
```

アクセストークンを取得したら Bearer token として送ります。

```bash
curl -i http://localhost:3000/mcp \
  -H "Authorization: Bearer <access-token>"
```

## 参考

- Supabase JWT Signing Keys: https://supabase.com/docs/guides/auth/signing-keys
- Supabase OAuth 2.1 Server: https://supabase.com/docs/guides/auth/oauth-server/getting-started
- Supabase Login with GitHub: https://supabase.com/docs/guides/auth/social-login/auth-github
