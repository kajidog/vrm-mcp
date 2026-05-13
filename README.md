# mcp-vrm-player

開発中

`mcp-vrm-player` は、ChatGPT / Claude などの MCP Apps 対応チャット上で 3D VRM モデルを表示しながら会話できる MCP サーバーです。音声合成・リップシンク・表情・ポーズ・視線をまとめて制御します。

## 主な機能

- チャット内 3D VRM プレイヤー（VRM 1.0 / 0.x、Inline ↔ Fullscreen 切替）
- 母音タイミング駆動のリップシンク（mora 非対応エンジンは音量解析にフォールバック）
- 表情・ポーズ・視線・速度をセグメント単位で制御し、感情ごとに VRM 表情・話者をバインド
- 自動瞬き、ポーズのクロスフェード、Spring Bone の初期姿勢リセット
- TTS バックエンド: **VOICEVOX** / **さくらの AI Engine** / **AivisSpeech**
- チャット内 UI で VRM モデル・ポーズ・話者プレビュー（ポートレート / テスト発話）を管理
- マルチユーザー（OAuth JWT Bearer: Supabase / 任意の JWKS / ローカル開発用認証サーバー）
- ディスクキャッシュ + in-flight 重複排除、`speak_player` は先頭セグメントだけ先行合成

## MCP Apps（スマホからも使えます）

[ChatGPT](https://chatgpt.com) / [Claude](https://claude.ai) など MCP Apps 対応のチャットクライアントの会話画面内に、3D VRM プレイヤーがそのまま表示されます。**ネイティブアプリのインストールは不要で、スマートフォンのブラウザからもそのまま使えます** — チャットで VRM を呼び出して話させたり、モデル管理画面でモデル登録・ポーズ追加・話者プレビューを行ったりできます。

`speak_player` / `open_model_manager` は MCP Apps UI を開けるクライアントから利用してください。

## クイックスタート

```bash
pnpm i
pnpm dev
```

## Docker Compose で起動

通常の HTTP モード:

```bash
docker compose up --build
```

ローカル認証つき HTTP モード:

```bash
docker compose -f compose.yaml -f compose.auth.yaml up --build
```

Supabase 認証つき HTTP モード:

```bash
MCP_AUTH_SERVER_URL=https://<project-ref>.supabase.co/auth/v1 \
MCP_JWKS_URI=https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json \
MCP_ISSUER=https://<project-ref>.supabase.co/auth/v1 \
VITE_SUPABASE_URL=https://<project-ref>.supabase.co \
VITE_SUPABASE_ANON_KEY=<your-anon-key> \
docker compose -f compose.yaml -f compose.supabase.yaml up --build
```

- MCP エンドポイント: `http://localhost:3000/mcp`
- ヘルスチェック: `http://localhost:3000/health`
- 認証つき起動時の Auth UI: `http://localhost:5173`
- ローカル認証つき起動時の開発用 Auth Server: `http://localhost:3001`

既定ではホスト側の VOICEVOX Engine を `http://host.docker.internal:50021` として参照します。別の URL や AivisSpeech (既定 `http://localhost:10101`) を使う場合は `.env` かコマンドラインで `TTS_ENGINE` と `TTS_BASE_URL` を指定してください。

```bash
TTS_ENGINE=aivisspeech TTS_BASE_URL=http://host.docker.internal:10101 docker compose up --build
```

## MCP ツール一覧

- `vrm_start_here`
- `vrm_find_models`
- `vrm_speak_player` (App tool)
- `vrm_open_model_manager` (App tool)
- `vrm_list_vrms`

## 主要設定

- `--engine` / `TTS_ENGINE`: `voicevox` / `sakuraai` / `aivisspeech`
- `--base-url` / `TTS_BASE_URL`: TTS エンジン URL（既定: VOICEVOX `http://localhost:50021`、AivisSpeech `http://localhost:10101`、さくらの AI `https://api.ai.sakura.ad.jp`）
- `--speaker` / `TTS_DEFAULT_SPEAKER`: デフォルト話者 ID
- `--disable-tools` / `TTS_DISABLED_TOOLS`: 無効化するツール名
- `--disable-groups` / `TTS_DISABLED_GROUPS`: 無効化グループ（`player`, `dictionary`, `file`, `apps`）
- `--auto-play` / `TTS_AUTO_PLAY`: UI プレイヤー自動再生

`--init` で `.ttsrc.json` テンプレートを生成できます。

> **AivisSpeech 利用時の注意**: VOICEVOX 互換 API ですが `audio_query` の mora 長 (`consonant_length` / `vowel_length` / `pitch`) が常に 0 で返ります。`mcp-vrm-player` は `aivisspeech` エンジンを選択すると音素タイミング駆動のリップシンクを自動的に無効化し、AnalyserNode の音量解析によるリップシンクにフォールバックします。

## OAuth 認証

HTTP モードでは OAuth JWT Bearer 認証を有効化できます。有効時は `/mcp`, `/vrms/:fileName`, `/poses/:fileName` が `Authorization: Bearer <JWT>` 必須になり、`/health` と `/.well-known/oauth-protected-resource` は認証不要です。

```bash
MCP_HTTP_MODE=true
MCP_OAUTH_ENABLED=true
MCP_SERVER_URL=http://localhost:3000
MCP_AUTH_SERVER_URL=http://localhost:3001
MCP_JWKS_URI=http://localhost:3001/.well-known/jwks.json
MCP_OAUTH_AUDIENCE=http://localhost:3000
MCP_RESOURCE_NAME="VRM MCP Server"
```

`MCP_ISSUER` を指定した場合は JWT の `iss` も検証します。`MCP_OAUTH_AUDIENCE` は JWT の `aud` 検証値で、未指定時は `MCP_SERVER_URL` を使います。Supabase OAuth Server を使う場合は通常 `authenticated` を指定します。`MCP_OAUTH_SCOPES` は metadata で公開するスコープで、既定は Supabase 標準の `openid,email,profile` です。OAuth 有効時は `MCP_API_KEY` より OAuth JWT が優先され、`/mcp` では API キー認証を要求しません。

詳しいローカル開発手順、Supabase 設定、環境変数一覧は [docs/auth-setup.md](docs/auth-setup.md) を参照してください。
