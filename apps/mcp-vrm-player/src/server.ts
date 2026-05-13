import { TtsClient, createEngine } from '@kajidog/tts-client'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getConfig } from './config.js'
import { expandGroups } from './tool-groups.js'
import { registerPlayerTools } from './tools/player.js'
import type { ToolDeps } from './tools/types.js'

// 設定を取得
const config = getConfig()

/**
 * McpServer を作成しツールを登録するファクトリ関数
 * HTTPモードではセッションごとに新しいインスタンスが必要
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'mcp-vrm-player',
    version: '0.1.0',
  })

  const engine = createEngine({
    engine: config.engine,
    baseUrl: config.baseUrl,
    apiKey: config.engineApiKey,
  })

  const ttsClient = new TtsClient({
    ttsEngine: engine,
    defaultSpeaker: config.defaultSpeaker,
    defaultSpeedScale: config.defaultSpeedScale,
  })

  // 共通依存オブジェクト
  const deps: ToolDeps = {
    server,
    ttsClient,
    engine,
    capabilities: engine.capabilities,
    config,
    disabledTools: new Set([...config.disabledTools, ...expandGroups(config.disabledGroups ?? [])]),
  }

  // ツール登録
  registerPlayerTools(deps)

  return server
}

// 後方互換性のためのデフォルトインスタンス（stdio用）
export const server = createServer()

// 設定エクスポート（テスト用）
export { config }
