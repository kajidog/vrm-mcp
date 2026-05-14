# mcp-vrm-player

開発中

`mcp-vrm-player` は、ChatGPT / Claude などの MCP Apps 対応チャット上で 3D VRM モデルを表示しながら会話できる MCP サーバーです。音声合成・リップシンク・表情・ポーズ・視線をまとめて制御します。

## できること

- 3D VRM プレイヤー（VRM 1.0 / 0.x、Inline / Fullscreen 切替）
- 音素タイミング駆動のリップシンク。`aivisspeech` 選択時は音量解析にフォールバック
- セグメント単位で表情・ポーズ・視線・速度を制御。感情ごとに VRM 表情と話者をバインド
- 自動瞬き、ポーズのクロスフェード、Spring Bone の初期姿勢リセット
- TTS バックエンド: VOICEVOX / さくらの AI Engine / AivisSpeech
- チャット内 UI で VRM モデル・ポーズ・話者プレビュー（ポートレート / テスト発話）を管理
- OAuth JWT Bearer 認証（Supabase / 任意の JWKS / ローカル開発用認証サーバー）
- ディスクキャッシュ + in-flight 重複排除。`vrm_speak_player` は先頭セグメントだけ先行合成

## MCP Apps

[ChatGPT](https://chatgpt.com) / [Claude](https://claude.ai) など MCP Apps 対応クライアントの会話画面内に、3D VRM プレイヤーが描画されます。

- ネイティブアプリのインストールは不要。スマートフォンのブラウザでも動作します
- チャットから VRM を呼び出して発話させたり、モデル管理画面でモデル登録・ポーズ追加・話者プレビューが行えます
- `vrm_speak_player` / `vrm_open_model_manager` は MCP Apps UI を開けるクライアントから利用してください

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

## MCP ツール（AI から呼ぶもの）

| ツール名 | 主な引数 | 用途 |
| --- | --- | --- |
| `vrm_start_here` | （なし） | 最初に呼ぶ。エンジン状態・登録モデル概要・既定モデル・既定ポーズ名・感情名・プレイヤー設定を返す |
| `vrm_find_models` | `modelId?`, `query?` | 登録モデルと有効なポーズ名を検索。`modelId` / `segments[].pose` を決める前に呼ぶ |
| `vrm_list_vrms` | （なし） | 登録 VRM 一覧を返す。話者 ID・感情バインド・ポーズ・更新時刻などのメタデータ込み |
| `vrm_speak_player` (App tool) | `modelId?`, `segments[]` | VRM プレイヤー UI を開き、セグメント単位で発話・表情・ポーズ・視線・速度を再生 |
| `vrm_open_model_manager` (App tool) | `modelId?`, `knowsHowToUse?` | VRM の登録 / 編集 UI を開く |

`segments[]` の要素は `{ text, emotion?, pose?, gaze?, speedScale? }`。`emotion` は `neutral` / `happy` / `angry` / `sad` / `relaxed` / `surprised` / `serious`、`gaze` は `camera`（視線を合わせる） / `away`（そらす） / `front`（正面）。

## 起動オプション

優先順位: CLI 引数 > 環境変数 > `.ttsrc.json` > 既定値。

- `--engine` / `TTS_ENGINE`: `voicevox` / `sakuraai` / `aivisspeech`
- `--base-url` / `TTS_BASE_URL`: TTS エンジン URL（既定: VOICEVOX `http://localhost:50021`、AivisSpeech `http://localhost:10101`、さくらの AI `https://api.ai.sakura.ad.jp`）
- `--speaker` / `TTS_DEFAULT_SPEAKER`: デフォルト話者 ID
- `--disable-tools` / `TTS_DISABLED_TOOLS`: 無効化するツール名
- `--disable-groups` / `TTS_DISABLED_GROUPS`: 無効化グループ（`player`, `dictionary`, `file`, `apps`）
- `--auto-play` / `TTS_AUTO_PLAY`: UI プレイヤー自動再生

`--init` で `.ttsrc.json` テンプレートを生成できます。

> **AivisSpeech 利用時の注意**: VOICEVOX 互換 API ですが `audio_query` の mora 長 (`consonant_length` / `vowel_length` / `pitch`) が常に 0 で返ります。`mcp-vrm-player` は `aivisspeech` エンジンを選択すると音素タイミング駆動のリップシンクを自動的に無効化し、AnalyserNode の音量解析によるリップシンクにフォールバックします。

## OAuth 認証

HTTP モードでは OAuth JWT Bearer 認証を有効化できます。

```bash
MCP_HTTP_MODE=true
MCP_OAUTH_ENABLED=true
MCP_SERVER_URL=http://localhost:3000
MCP_AUTH_SERVER_URL=http://localhost:3001
MCP_JWKS_URI=http://localhost:3001/.well-known/jwks.json
MCP_OAUTH_AUDIENCE=http://localhost:3000
MCP_RESOURCE_NAME="VRM MCP Server"
```

環境変数:

- `MCP_HTTP_MODE` / `MCP_OAUTH_ENABLED`: HTTP モード + OAuth を有効化
- `MCP_SERVER_URL`: 公開する MCP サーバー URL
- `MCP_AUTH_SERVER_URL` / `MCP_JWKS_URI`: 認可サーバーと JWKS の場所
- `MCP_OAUTH_AUDIENCE`: JWT の `aud` 検証値。未指定時は `MCP_SERVER_URL`
- `MCP_ISSUER`: 指定時は JWT の `iss` も検証
- `MCP_OAUTH_SCOPES`: metadata に公開するスコープ。既定は `openid,email,profile`
- `MCP_RESOURCE_NAME`: protected resource metadata のリソース名

エンドポイントと認証:

- 認証必須: `/mcp`, `/vrms/:fileName`, `/poses/:fileName`
- 認証不要: `/health`, `/.well-known/oauth-protected-resource`

注記:

- Supabase OAuth Server を使う場合、`MCP_OAUTH_AUDIENCE` には通常 `authenticated` を指定します
- OAuth 有効時は OAuth JWT が `MCP_API_KEY` より優先され、`/mcp` で API キー認証は要求されません

詳しいローカル開発手順、Supabase 設定、環境変数一覧は [docs/auth-setup.md](docs/auth-setup.md) を参照してください。
