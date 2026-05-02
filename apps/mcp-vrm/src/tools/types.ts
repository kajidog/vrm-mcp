import type { EngineCapabilities, TtsClient, TtsEngine } from '@kajidog/tts-client'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerConfig } from '../config.js'

// ツールハンドラーのextraパラメータ用の型定義
export interface ToolHandlerExtra {
  sessionId?: string
}

// 各 register*Tools に渡す共通依存オブジェクト
export interface ToolDeps {
  server: McpServer
  ttsClient: TtsClient
  engine: TtsEngine
  capabilities: EngineCapabilities
  config: ServerConfig
  disabledTools: Set<string>
}

// Player ツール固有の依存
export interface PlayerToolDeps extends ToolDeps {
  playerEngine: TtsEngine
}
