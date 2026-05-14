/**
 * MCP TTS 設定モジュール
 *
 * 優先順位: CLI引数 > 環境変数 > 設定ファイル > デフォルト値
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  type BaseServerConfig,
  type ConfigDefs,
  baseConfigDefs,
  filterUndefined,
  generateConfigTemplate,
  generateHelp,
  getDefaultsFromDefs,
  parseCliFromDefs,
  parseConfigFileFromDefs,
  parseEnvFromDefs,
} from '@kajidog/mcp-core'

// TTS固有の設定定義
const ttsConfigDefs: ConfigDefs = {
  engine: {
    cli: '--engine',
    env: 'TTS_ENGINE',
    description: 'TTS engine (voicevox | sakuraai | aivisspeech)',
    group: 'TTS Configuration',
    type: 'string',
    default: 'voicevox',
    valueName: '<engine>',
  },
  baseUrl: {
    cli: '--base-url',
    env: 'TTS_BASE_URL',
    description: 'TTS engine base URL',
    group: 'TTS Configuration',
    type: 'string',
    valueName: '<url>',
  },
  engineApiKey: {
    cli: '--engine-api-key',
    env: 'TTS_API_KEY',
    description: 'TTS engine API key (env/CLI only; never written to config files)',
    group: 'TTS Configuration',
    type: 'string',
    valueName: '<key>',
  },
  defaultSpeaker: {
    cli: '--speaker',
    env: 'TTS_DEFAULT_SPEAKER',
    description: 'Default speaker ID',
    group: 'TTS Configuration',
    type: 'number',
    default: 1,
    valueName: '<id>',
  },
  defaultSpeedScale: {
    cli: '--speed',
    env: 'TTS_DEFAULT_SPEED_SCALE',
    description: 'Default playback speed',
    group: 'TTS Configuration',
    type: 'number',
    default: 1.0,
    valueName: '<scale>',
  },
  defaultPrePhonemeLength: {
    cli: '--pre-phoneme',
    env: 'TTS_PRE_PHONEME_LENGTH',
    description: 'Default pre-phoneme silence length for UI player synthesis',
    group: 'TTS Configuration',
    type: 'number',
    valueName: '<seconds>',
  },
  defaultPostPhonemeLength: {
    cli: '--post-phoneme',
    env: 'TTS_POST_PHONEME_LENGTH',
    description: 'Default post-phoneme silence length for UI player synthesis',
    group: 'TTS Configuration',
    type: 'number',
    valueName: '<seconds>',
  },
  defaultImmediate: {
    cli: '--immediate',
    env: 'TTS_DEFAULT_IMMEDIATE',
    description: 'Enable immediate playback',
    group: 'Playback Options',
    type: 'boolean',
    default: true,
  },
  defaultWaitForStart: {
    cli: '--wait-for-start',
    env: 'TTS_DEFAULT_WAIT_FOR_START',
    description: 'Enable waiting until playback starts by default',
    group: 'Playback Options',
    type: 'boolean',
    default: false,
  },
  defaultWaitForEnd: {
    cli: '--wait-for-end',
    env: 'TTS_DEFAULT_WAIT_FOR_END',
    description: 'Enable waiting until playback ends by default',
    group: 'Playback Options',
    type: 'boolean',
    default: false,
  },
  restrictImmediate: {
    cli: '--restrict-immediate',
    env: 'TTS_RESTRICT_IMMEDIATE',
    description: 'Restrict immediate playback option',
    group: 'Playback Restrictions',
    type: 'boolean',
    default: false,
  },
  restrictWaitForStart: {
    cli: '--restrict-wait-for-start',
    env: 'TTS_RESTRICT_WAIT_FOR_START',
    description: 'Restrict wait-for-start option',
    group: 'Playback Restrictions',
    type: 'boolean',
    default: false,
  },
  restrictWaitForEnd: {
    cli: '--restrict-wait-for-end',
    env: 'TTS_RESTRICT_WAIT_FOR_END',
    description: 'Restrict wait-for-end option',
    group: 'Playback Restrictions',
    type: 'boolean',
    default: false,
  },
  useStreaming: {
    cli: '--use-streaming',
    env: 'TTS_USE_STREAMING',
    description: 'Enable streaming synthesis when supported',
    group: 'Playback Options',
    type: 'boolean',
  },
  disabledTools: {
    cli: '--disable-tools',
    env: 'TTS_DISABLED_TOOLS',
    description: 'Comma-separated list of tools to disable',
    group: 'Tool Options',
    type: 'string[]',
    default: [],
    valueName: '<tools>',
  },
  disabledGroups: {
    cli: '--disable-groups',
    env: 'TTS_DISABLED_GROUPS',
    description:
      'Comma-separated list of tool groups to disable. Built-in groups: player (all player UI tools), dictionary (all dictionary read+write tools), file (synthesize_file), apps (MCP App UI tools)',
    group: 'Tool Options',
    type: 'string[]',
    default: [],
    valueName: '<groups>',
  },
  autoPlay: {
    cli: '--auto-play',
    env: 'TTS_AUTO_PLAY',
    description: 'Auto-play audio in UI player',
    group: 'UI Player Options',
    type: 'boolean',
    default: true,
  },
  playerExportEnabled: {
    cli: '--player-export',
    env: 'TTS_PLAYER_EXPORT_ENABLED',
    description: 'Enable exporting generated player audio',
    group: 'UI Player Options',
    type: 'boolean',
    default: true,
  },
  playerExportDir: {
    cli: '--player-export-dir',
    env: 'TTS_PLAYER_EXPORT_DIR',
    description: 'Player audio export directory',
    group: 'UI Player Options',
    type: 'string',
    valueName: '<dir>',
  },
  playerCacheDir: {
    cli: '--player-cache-dir',
    env: 'TTS_PLAYER_CACHE_DIR',
    description: 'Player cache directory',
    group: 'UI Player Options',
    type: 'string',
    valueName: '<dir>',
  },
  playerStateFile: {
    cli: '--player-state-file',
    env: 'TTS_PLAYER_STATE_FILE',
    description: 'Persisted player state file path',
    group: 'UI Player Options',
    type: 'string',
    valueName: '<path>',
  },
  playerAudioCacheEnabled: {
    cli: '--player-audio-cache',
    env: 'TTS_PLAYER_AUDIO_CACHE_ENABLED',
    description: 'Enable disk audio cache for player',
    group: 'UI Player Options',
    type: 'boolean',
    default: true,
  },
  playerAudioCacheTtlDays: {
    cli: '--player-audio-cache-ttl-days',
    env: 'TTS_PLAYER_AUDIO_CACHE_TTL_DAYS',
    description: 'Audio cache retention days (0 disables, -1 unlimited)',
    group: 'UI Player Options',
    type: 'number',
    default: 30,
    valueName: '<days>',
  },
  playerAudioCacheMaxMb: {
    cli: '--player-audio-cache-max-mb',
    env: 'TTS_PLAYER_AUDIO_CACHE_MAX_MB',
    description: 'Audio cache size cap in MB (0 disables, -1 unlimited)',
    group: 'UI Player Options',
    type: 'number',
    default: 512,
    valueName: '<mb>',
  },
  playerDomain: {
    cli: '--player-domain',
    env: 'TTS_PLAYER_DOMAIN',
    description: 'Player domain',
    group: 'UI Player Options',
    type: 'string',
    default: '',
    valueName: '<domain>',
  },
  playerDefaultVrmPath: {
    cli: '--player-default-vrm-path',
    env: 'TTS_PLAYER_DEFAULT_VRM_PATH',
    description: 'Default VRM file path for the player UI fallback',
    group: 'UI Player Options',
    type: 'string',
    default: '',
    valueName: '<path>',
  },
  configFile: {
    cli: '--config',
    env: 'TTS_CONFIG',
    description: 'Path to config file (.ttsrc.json)',
    group: 'Utility Options',
    type: 'string',
    valueName: '<path>',
  },
}

// 全設定定義（TTS + base）
export const allConfigDefs: ConfigDefs = {
  ...ttsConfigDefs,
  ...baseConfigDefs,
}

// 設定型定義（BaseServerConfigを拡張）
export interface ServerConfig extends BaseServerConfig {
  // TTS設定
  engine: string
  baseUrl?: string
  engineApiKey?: string
  defaultSpeaker: number
  defaultSpeedScale: number
  defaultPrePhonemeLength?: number
  defaultPostPhonemeLength?: number
  defaultWaitForStart: boolean
  defaultWaitForEnd: boolean
  restrictImmediate: boolean
  restrictWaitForStart: boolean
  restrictWaitForEnd: boolean
  useStreaming?: boolean

  // UIプレイヤー設定
  playerDomain: string
  autoPlay: boolean
  playerExportEnabled: boolean
  playerExportDir: string
  playerCacheDir: string
  playerStateFile: string
  playerAudioCacheEnabled: boolean
  playerAudioCacheTtlDays: number
  playerAudioCacheMaxMb: number
  playerDefaultVrmPath: string

  // 無効化ツール
  disabledTools: string[]
  disabledGroups: string[]
}

// パスのデフォルト値（process.cwd()依存のため関数で生成）
function getPathDefaults() {
  return {
    playerExportDir: join(process.cwd(), 'tts-player-exports'),
    playerCacheDir: join(process.cwd(), '.tts-player-cache'),
    playerStateFile: join(process.cwd(), '.tts-player-cache', 'player-state.json'),
  }
}

// デフォルト設定
function createDefaultConfig(): ServerConfig {
  const schemaDefs = getDefaultsFromDefs(allConfigDefs) as Record<string, unknown>
  const pathDefs = getPathDefaults()
  return {
    ...schemaDefs,
    ...pathDefs,
  } as unknown as ServerConfig
}

/**
 * CLI引数をパースする
 */
export function parseCliArgs(argv: string[] = process.argv.slice(2)): Partial<ServerConfig> {
  return parseCliFromDefs(allConfigDefs, argv) as Partial<ServerConfig>
}

/**
 * 環境変数から設定を読み込む
 */
export function parseEnvVars(env: NodeJS.ProcessEnv = process.env): Partial<ServerConfig> {
  return parseEnvFromDefs(allConfigDefs, env) as Partial<ServerConfig>
}

/**
 * 設定ファイルを読み込む
 *
 * --config で指定されたパスか、カレントディレクトリの .ttsrc.json を読み込む。
 * ファイルが存在しない場合は空オブジェクトを返す。
 */
export function parseConfigFile(configPath?: string): Partial<ServerConfig> {
  const filePath = configPath ? resolve(configPath) : join(process.cwd(), '.ttsrc.json')

  if (!existsSync(filePath)) {
    return {}
  }

  try {
    const content = JSON.parse(readFileSync(filePath, 'utf-8'))
    rejectSecretsInConfigFile(content, filePath)
    return parseConfigFileFromDefs(allConfigDefs, content) as Partial<ServerConfig>
  } catch (error) {
    if (error instanceof Error && error.message.includes('must not contain API keys')) {
      throw error
    }
    return {}
  }
}

/**
 * 設定を取得する（優先順位: CLI引数 > 環境変数 > 設定ファイル > デフォルト値）
 */
export function getConfig(argv?: string[], env?: NodeJS.ProcessEnv): ServerConfig {
  const cliConfig = parseCliArgs(argv)
  const envConfig = parseEnvVars(env)

  // 設定ファイルパスをCLI/envから取得
  const configFilePath =
    ((cliConfig as Record<string, unknown>).configFile as string | undefined) ??
    ((envConfig as Record<string, unknown>).configFile as string | undefined)
  const fileConfig = parseConfigFile(configFilePath)

  const defaultConfig = createDefaultConfig()
  const merged: ServerConfig = {
    ...defaultConfig,
    ...filterUndefined(fileConfig),
    ...filterUndefined(envConfig),
    ...filterUndefined(cliConfig),
  }

  // playerStateFile が明示指定されていない場合は、確定した cacheDir に追従させる
  const isPlayerStateFileExplicit =
    envConfig.playerStateFile !== undefined ||
    cliConfig.playerStateFile !== undefined ||
    fileConfig.playerStateFile !== undefined
  if (!isPlayerStateFileExplicit) {
    merged.playerStateFile = join(merged.playerCacheDir, 'player-state.json')
  }
  if (!merged.baseUrl) {
    if (merged.engine === 'sakuraai') {
      merged.baseUrl = 'https://api.ai.sakura.ad.jp'
    } else if (merged.engine === 'aivisspeech') {
      merged.baseUrl = 'http://localhost:10101'
    } else {
      merged.baseUrl = 'http://localhost:50021'
    }
  }
  if (merged.engine === 'sakuraai' && !merged.engineApiKey) {
    throw new Error('TTS_ENGINE=sakuraai requires TTS_API_KEY or --engine-api-key')
  }
  // configFile は内部用なので削除
  ;(merged as unknown as Record<string, unknown>).configFile = undefined

  return merged
}

/**
 * help文を生成する
 */
export function getHelpText(): string {
  return generateHelp(allConfigDefs, {
    usage: 'npx @kajidog/mcp-vrm-player [options]',
    examples: [
      'npx @kajidog/mcp-vrm-player --engine voicevox --base-url http://192.168.1.50:50021 --speaker 3',
      'npx @kajidog/mcp-vrm-player --engine aivisspeech --base-url http://localhost:10101',
      'TTS_ENGINE=sakuraai TTS_API_KEY=... npx @kajidog/mcp-vrm-player',
      'npx @kajidog/mcp-vrm-player --http --port 8080',
      'npx @kajidog/mcp-vrm-player --disable-tools synthesize_file',
      'npx @kajidog/mcp-vrm-player --disable-groups player,dictionary',
      'npx @kajidog/mcp-vrm-player --config ./my-config.json',
      'npx @kajidog/mcp-vrm-player --init',
    ],
  })
}

/**
 * 設定ファイルのテンプレートJSONを生成する
 */
export function getConfigTemplate(): Record<string, unknown> {
  return generateConfigTemplate(allConfigDefs, { exclude: ['configFile', 'apiKey', 'engineApiKey'] })
}

const secretConfigKeys = new Set(['apiKey', 'api-key', 'engineApiKey', 'engine-api-key', 'ttsApiKey', 'tts-api-key'])

function rejectSecretsInConfigFile(content: unknown, filePath: string): void {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return
  const found = Object.keys(content).filter((key) => secretConfigKeys.has(key))
  if (found.length > 0) {
    throw new Error(
      `${filePath} must not contain API keys (${found.join(', ')}). Use TTS_API_KEY or --engine-api-key instead.`
    )
  }
}

// シングルトンとしてエクスポート（キャッシュ）
let cachedConfig: ServerConfig | null = null

/**
 * キャッシュされた設定を取得する
 */
export function getCachedConfig(): ServerConfig {
  if (!cachedConfig) {
    cachedConfig = getConfig()
  }
  return cachedConfig
}

/**
 * キャッシュをリセットする（テスト用）
 */
export function resetConfigCache(): void {
  cachedConfig = null
}
