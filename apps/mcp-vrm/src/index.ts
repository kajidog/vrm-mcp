#!/usr/bin/env node
// MCP TTS エントリーポイント

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOAuthConfig, isNodejs, launchServer, setSessionConfig } from '@kajidog/mcp-core'
import { getConfig, getConfigTemplate, getHelpText } from './config.js'
import { createVrmOAuthHttpOptions } from './oauth.js'
import { createServer, server } from './server.js'
import { bindSessionAuth, forgetSessionUser } from './tools/auth-context.js'
import { getPlayerRuntimeStores } from './tools/player/runtime.js'
import { registerVrmHttpRoutes } from './vrm-http.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 型定義
interface IndexServerConfig {
  port: number
  host: string
  isDevelopment: boolean
  isHttpMode: boolean
}

function isEntrypoint(metaUrl: string): boolean {
  if (!isNodejs() || !process.argv?.[1]) return false
  return fileURLToPath(metaUrl) === resolve(process.argv[1])
}

/**
 * サーバー設定を取得する関数
 */
function getServerConfig(): IndexServerConfig {
  const config = getConfig()

  return {
    port: config.httpPort,
    host: config.httpHost,
    isDevelopment: process.env.NODE_ENV === 'development',
    isHttpMode: config.httpMode,
  }
}

/**
 * ヘルプメッセージを表示する（設定定義から自動生成）
 */
function printHelp() {
  console.log(`\n${getHelpText()}`)
}

/**
 * MCP サーバーを起動する
 */
async function startMCPServer(): Promise<void> {
  // 環境チェック
  if (!isNodejs()) {
    throw new Error('Node.js environment required')
  }

  // ヘルプオプションの確認
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp()
    process.exit(0)
  }

  // バージョンオプションの確認
  if (process.argv.includes('--version') || process.argv.includes('-v')) {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'))
    console.log(`@kajidog/vrm-mcp v${pkg.version}`)
    process.exit(0)
  }

  // --init: 設定ファイルのテンプレートを生成
  if (process.argv.includes('--init')) {
    const outputPath = join(process.cwd(), '.ttsrc.json')
    if (existsSync(outputPath)) {
      console.error('.ttsrc.json already exists. Remove it first or edit it directly.')
      process.exit(1)
    }
    const template = getConfigTemplate()
    writeFileSync(outputPath, `${JSON.stringify(template, null, 2)}\n`)
    console.log('Created .ttsrc.json with default settings.')
    console.log('Edit the file to customize your configuration.')
    process.exit(0)
  }

  const config = getConfig()
  const serverConfig = getServerConfig()

  if (serverConfig.isHttpMode) {
    console.error(
      `VRM MCP HTTP mode: host=${serverConfig.host} port=${serverConfig.port} env=${
        serverConfig.isDevelopment ? 'development' : 'production'
      }`
    )
  }

  // mcp-core のランチャーを使用してサーバーを起動
  const authConfig = createOAuthConfig(config, { resourceName: 'VRM MCP Server' })
  await launchServer({
    server,
    config,
    serverName: 'MCP TTS',
    serverFactory: createServer,
    httpOptions: {
      extraCorsHeaders: ['X-TTS-Speaker'],
      ...createVrmOAuthHttpOptions(authConfig),
      configureApp: (app) => {
        registerVrmHttpRoutes(app, config, getPlayerRuntimeStores() ?? undefined)
      },
      onSessionInitialized: (sessionId, request, authInfo) => {
        bindSessionAuth({ sessionId, authInfo })

        // X-TTS-Speaker ヘッダーからセッションのデフォルト話者を設定
        const speakerHeader = request.headers.get('X-TTS-Speaker')
        if (speakerHeader) {
          const parsed = Number.parseInt(speakerHeader, 10)
          if (!Number.isNaN(parsed) && parsed >= 0) {
            setSessionConfig(sessionId, { defaultSpeaker: parsed })
            console.log(`Session ${sessionId} default speaker: ${parsed}`)
          }
        }
      },
      onSessionClosed: (sessionId) => {
        forgetSessionUser(sessionId)
      },
    },
  })
}

if (isEntrypoint(import.meta.url)) {
  startMCPServer().catch((error) => {
    console.error('Initialization error:', error)
    process.exit(1)
  })
}
