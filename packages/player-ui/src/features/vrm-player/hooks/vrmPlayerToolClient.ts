import type { App } from '@modelcontextprotocol/ext-apps'
import type { EmotionBinding } from '~/features/emotions'
import type { ModelPoseAttachment } from '~/features/poses/types'
import type { AudioQuery } from '~/types'
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
 *   { source: 'active',   metadata, vrmUrl, vrmMimeType }
 *   { source: 'registry', metadata, vrmUrl, vrmMimeType }
 *   { source: 'config',   vrmBase64, vrmMimeType, sourcePath }
 *   { source: 'none' }
 *
 * `source: 'none'` または VRM ペイロードが無い場合は null を返し、UI は空表示にする。
 * registry 経由のデフォルトでは metadata（speakerId 等）も合わせて返し、
 * 呼び出し側で active model 表示や話者アイコンに利用できるようにする。
 */
export interface DefaultVrmResolution {
  payload: VrmPayload
  metadata?: VrmListEntry
}

export async function fetchDefaultVrmOnServer(app: App): Promise<DefaultVrmResolution | null> {
  const result = await app.callServerTool({
    name: '_resolve_default_vrm_for_player',
    arguments: {},
  })
  assertNoToolError(result)

  const payload = getTextPayload(result.content)
  if (!payload) return null

  const parsed = JSON.parse(payload) as {
    source?: 'active' | 'registry' | 'config' | 'none'
    metadata?: VrmListEntry
    vrmUrl?: string
    vrmBase64?: string
    vrmMimeType?: string
  }

  if (parsed.source === 'none' || (!parsed.vrmUrl && !parsed.vrmBase64)) return null
  return {
    payload: {
      vrmUrl: parsed.vrmUrl,
      vrmBase64: parsed.vrmBase64,
      vrmMimeType: parsed.vrmMimeType ?? 'model/gltf-binary',
    },
    metadata: parsed.metadata,
  }
}

export interface SegmentAudio {
  index: number
  audioBase64?: string
  audioMimeType?: string
  speedScale?: number
  audioQuery?: AudioQuery
  prePhonemeLength?: number
  postPhonemeLength?: number
}

/**
 * speak_player 結果は音声バイナリを含まないので、viewUUID で別途取得する。
 * サーバ側はキャッシュ済みの合成結果を返すだけなので呼び出しコストは低い。
 */
export async function fetchSegmentsAudioOnServer(
  app: App,
  viewUUID: string,
  index?: number
): Promise<{ audioMimeType: string; segments: SegmentAudio[] }> {
  const result = await app.callServerTool({
    name: '_get_player_audio_for_player',
    arguments: { viewUUID, ...(index !== undefined ? { index } : {}) },
  })
  assertNoToolError(result)

  const payload = getTextPayload(result.content)
  if (!payload) throw new Error('Tool returned no text content')

  try {
    const parsed = JSON.parse(payload) as {
      audioMimeType?: string
      segments?: SegmentAudio[]
    }
    if (!Array.isArray(parsed.segments)) throw new Error('segments missing in response')
    const segments = parsed.segments.map((segment) => ({
      ...segment,
      audioMimeType: parsed.audioMimeType ?? segment.audioMimeType ?? 'audio/wav',
    }))
    const missing = segments.find((segment) => !segment.audioBase64)
    if (missing) throw new Error(`audioBase64 missing for segment ${missing.index}`)
    return {
      audioMimeType: parsed.audioMimeType ?? 'audio/wav',
      segments,
    }
  } catch (error) {
    throw new Error(`Invalid player audio response: ${error instanceof Error ? error.message : String(error)}`)
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
  audioQuery?: AudioQuery
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
    audioQuery?: AudioQuery
    prePhonemeLength?: number
    postPhonemeLength?: number
  }
  if (!parsed.audioBase64) throw new Error('audioBase64 missing in response')
  return {
    audioBase64: parsed.audioBase64,
    audioMimeType: parsed.audioMimeType ?? 'audio/wav',
    speedScale: parsed.speedScale,
    audioQuery:
      parsed.audioQuery && typeof parsed.audioQuery === 'object'
        ? (parsed.audioQuery as unknown as AudioQuery)
        : undefined,
    prePhonemeLength: parsed.prePhonemeLength,
    postPhonemeLength: parsed.postPhonemeLength,
  }
}

export interface VrmListEntry {
  id: string
  ownerUserId?: string
  name: string
  speakerId: number
  isDefault?: boolean
  isPublic?: boolean
  canEdit?: boolean
  poses?: ModelPoseAttachment[]
  emotionBindings?: EmotionBinding[]
  thumbnailBase64?: string
  thumbnailMimeType?: string
}

interface SpeakerEntry {
  id: number
  name: string
  characterName: string
  uuid: string
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

/** 指定モデルの VRM データを取得する。 */
export async function fetchVrmModelOnServer(
  app: App,
  modelId: string
): Promise<{ metadata: VrmListEntry; payload: VrmPayload }> {
  const result = await app.callServerTool({
    name: '_get_vrm_for_player',
    arguments: { modelId },
  })
  assertNoToolError(result)

  const payload = getTextPayload(result.content)
  if (!payload) throw new Error('Tool returned no text content')
  const parsed = JSON.parse(payload) as {
    metadata?: VrmListEntry
    vrmUrl?: string
    vrmBase64?: string
    vrmMimeType?: string
  }
  if (!parsed.metadata || (!parsed.vrmUrl && !parsed.vrmBase64)) throw new Error('Invalid VRM metadata response')
  return {
    metadata: parsed.metadata,
    payload: {
      vrmUrl: parsed.vrmUrl,
      vrmBase64: parsed.vrmBase64,
      vrmMimeType: parsed.vrmMimeType ?? 'model/gltf-binary',
    },
  }
}

export async function fetchSpeakerIconOnServer(app: App, speakerId: number): Promise<string | undefined> {
  const speakersResult = await app.callServerTool({
    name: '_get_speakers_for_player',
    arguments: {},
  })
  assertNoToolError(speakersResult)

  const speakersPayload = getTextPayload(speakersResult.content)
  if (!speakersPayload) return undefined

  const speakers = JSON.parse(speakersPayload) as SpeakerEntry[]
  const speaker = speakers.find((entry) => entry.id === speakerId)
  if (!speaker?.uuid) return undefined

  const iconResult = await app.callServerTool({
    name: '_get_speaker_icon_for_player',
    arguments: { speakerUuid: speaker.uuid },
  })
  assertNoToolError(iconResult)

  const iconPayload = getTextPayload(iconResult.content)
  if (!iconPayload) return undefined
  const parsed = JSON.parse(iconPayload) as { portrait?: string | null }
  const portrait = parsed.portrait
  if (!portrait) return undefined
  // VOICEVOX の /speaker_info は portrait を生 base64 で返すので、
  // <img src> へ流す前に data URL へ整える。すでに data: なら変換しない。
  return portrait.startsWith('data:') ? portrait : `data:image/png;base64,${portrait}`
}

export interface PlayerSettings {
  speedScale?: number
  prePhonemeLength?: number
  postPhonemeLength?: number
  autoPlay?: boolean
  usePublicVrms?: boolean
  activeModelId?: string
}

export interface PlayerSettingsResponse {
  overrides: PlayerSettings
  cliDefaults: PlayerSettings & { speedScale: number; autoPlay: boolean }
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
