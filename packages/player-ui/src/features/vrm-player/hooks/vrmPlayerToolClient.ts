import type { App } from '@modelcontextprotocol/ext-apps'
import type { VrmPayload } from '../types'

interface TextContent {
  type: 'text'
  text: string
}

// CallToolResult の content 配列から最初の text コンテンツを取り出す。
function getTextPayload(content: unknown): string | null {
  if (!Array.isArray(content)) return null
  const textContent = content.find((c) => (c as { type?: string }).type === 'text') as TextContent | undefined
  return textContent?.type === 'text' ? textContent.text : null
}

// isError=true の場合は text コンテンツをエラーメッセージとして送出する。
function assertNoToolError(result: { isError?: boolean; content?: unknown }): void {
  if (!result.isError) return
  const payload = getTextPayload(result.content)
  throw new Error(payload ?? 'Tool call failed')
}

/**
 * サーバ側の `_resolve_default_vrm_for_player` を叩き、デフォルト VRM を取得する。
 *
 * 戻り値:
 *   { source: 'registry', metadata, vrmBase64, vrmMimeType }
 *   { source: 'config',   vrmBase64, vrmMimeType, sourcePath }
 *   { source: 'none' }
 *
 * `source: 'none'` または vrmBase64 が無い場合は null を返し、UI は空表示にする。
 */
export async function fetchDefaultVrmOnServer(app: App): Promise<VrmPayload | null> {
  const result = await app.callServerTool({
    name: '_resolve_default_vrm_for_player',
    arguments: {},
  })
  assertNoToolError(result)

  const payload = getTextPayload(result.content)
  if (!payload) return null

  const parsed = JSON.parse(payload) as {
    source?: 'registry' | 'config' | 'none'
    vrmUrl?: string
    vrmBase64?: string
    vrmMimeType?: string
  }

  if (parsed.source === 'none' || (!parsed.vrmUrl && !parsed.vrmBase64)) return null
  return {
    vrmUrl: parsed.vrmUrl,
    vrmBase64: parsed.vrmBase64,
    vrmMimeType: parsed.vrmMimeType ?? 'model/gltf-binary',
  }
}

/**
 * モデル切替時に既存テキストを新しい話者で再合成する。
 * `_resynthesize_for_player` が無効化されている環境では呼び出し失敗するので例外送出。
 */
export async function resynthesizeSegmentOnServer(
  app: App,
  args: { speakerId: number; text: string; speedScale?: number; prePhonemeLength?: number; postPhonemeLength?: number }
): Promise<{
  audioBase64: string
  audioMimeType: string
  speedScale?: number
  prePhonemeLength?: number
  postPhonemeLength?: number
}> {
  const result = await app.callServerTool({
    name: '_resynthesize_for_player',
    arguments: args,
  })
  assertNoToolError(result)

  const payload = getTextPayload(result.content)
  if (!payload) throw new Error('Tool returned no text content')
  const parsed = JSON.parse(payload) as {
    audioBase64?: string
    audioMimeType?: string
    speedScale?: number
    prePhonemeLength?: number
    postPhonemeLength?: number
  }
  if (!parsed.audioBase64) throw new Error('audioBase64 missing in response')
  return {
    audioBase64: parsed.audioBase64,
    audioMimeType: parsed.audioMimeType ?? 'audio/wav',
    speedScale: parsed.speedScale,
    prePhonemeLength: parsed.prePhonemeLength,
    postPhonemeLength: parsed.postPhonemeLength,
  }
}

interface VrmListEntry {
  id: string
  name: string
  speakerId: number
  isDefault?: boolean
  thumbnailBase64?: string
  thumbnailMimeType?: string
}

/** 登録済み VRM 一覧の軽量取得（プレイヤー上のモデルピッカー用）。 */
export async function fetchVrmListOnServer(app: App): Promise<VrmListEntry[]> {
  const result = await app.callServerTool({
    name: '_list_vrms_for_player',
    arguments: {},
  })
  assertNoToolError(result)

  const payload = getTextPayload(result.content)
  if (!payload) return []
  try {
    const parsed = JSON.parse(payload) as { vrms?: VrmListEntry[] }
    return Array.isArray(parsed.vrms) ? parsed.vrms : []
  } catch {
    return []
  }
}

/** 指定モデルの VRM URL を取得する。 */
export async function fetchVrmModelOnServer(
  app: App,
  modelId: string
): Promise<{ metadata: VrmListEntry; vrmUrl: string }> {
  const result = await app.callServerTool({
    name: '_get_vrm_for_player',
    arguments: { modelId },
  })
  assertNoToolError(result)

  const payload = getTextPayload(result.content)
  if (!payload) throw new Error('Tool returned no text content')
  const parsed = JSON.parse(payload) as { metadata?: VrmListEntry; vrmUrl?: string }
  if (!parsed.metadata || !parsed.vrmUrl) throw new Error('Invalid VRM metadata response')
  return { metadata: parsed.metadata, vrmUrl: parsed.vrmUrl }
}

export interface PlayerSettings {
  speedScale?: number
  prePhonemeLength?: number
  postPhonemeLength?: number
}

export interface PlayerSettingsResponse {
  overrides: PlayerSettings
  cliDefaults: PlayerSettings & { speedScale: number }
}

export async function fetchPlayerSettingsOnServer(app: App): Promise<PlayerSettingsResponse> {
  const result = await app.callServerTool({
    name: '_get_player_settings_for_player',
    arguments: {},
  })
  assertNoToolError(result)

  const payload = getTextPayload(result.content)
  if (!payload) throw new Error('Tool returned no text content')
  return JSON.parse(payload) as PlayerSettingsResponse
}

export async function setPlayerSettingsOnServer(
  app: App,
  args: PlayerSettings & { reset?: boolean }
): Promise<PlayerSettingsResponse> {
  const result = await app.callServerTool({
    name: '_set_player_settings_for_player',
    arguments: { ...args },
  })
  assertNoToolError(result)

  const payload = getTextPayload(result.content)
  if (!payload) throw new Error('Tool returned no text content')
  return JSON.parse(payload) as PlayerSettingsResponse
}
