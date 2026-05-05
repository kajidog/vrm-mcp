import type { McpUiToolInputNotification } from '@modelcontextprotocol/ext-apps'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AudioQuery } from '~/types'
import type { VrmPayload } from '../types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// 文字列かつ空白のみでない値だけを返す（空文字を「未指定」として扱うため）。
export function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

/**
 * 任意のオブジェクトから VRM 関連フィールドを抽出する。
 * `vrm*` を一次キーに、`model*` を後方互換のエイリアスとしてフォールバック解決する。
 * いずれの主要フィールド（url/base64/path/resourceUri）も無ければ null を返す。
 */
export function pickVrmPayload(source: unknown): VrmPayload | null {
  if (!isRecord(source)) return null

  // speak_player の新形式は `vrmModel: { vrmUrl }` を入れ子で返す。最優先で拾う。
  const nested = isRecord(source.vrmModel) ? (source.vrmModel as Record<string, unknown>) : null

  const payload: VrmPayload = {
    vrmUrl:
      (nested ? readString(nested, 'vrmUrl') : undefined) ??
      readString(source, 'vrmUrl') ??
      readString(source, 'modelUrl'),
    vrmBase64: readString(source, 'vrmBase64') ?? readString(source, 'modelBase64'),
    vrmMimeType:
      (nested ? readString(nested, 'vrmMimeType') : undefined) ??
      readString(source, 'vrmMimeType') ??
      readString(source, 'modelMimeType'),
    vrmPath: readString(source, 'vrmPath') ?? readString(source, 'modelPath'),
    vrmResourceUri: readString(source, 'vrmResourceUri') ?? readString(source, 'modelResourceUri'),
  }

  if (payload.vrmUrl || payload.vrmBase64 || payload.vrmPath || payload.vrmResourceUri) {
    return payload
  }

  return null
}

// content[].type === 'text' の JSON 文字列をパースしてペイロード抽出。
function parseJsonTextPayload(result: CallToolResult): VrmPayload | null {
  const textContent = result.content?.find((content) => content.type === 'text')
  if (!textContent || textContent.type !== 'text') return null

  try {
    return pickVrmPayload(JSON.parse(textContent.text))
  } catch {
    return null
  }
}

/**
 * CallToolResult から VRM ペイロードを取り出す。
 * 優先順は structuredContent → _meta → resource(blob/text) → 生 text JSON。
 * 上位サーバが構造化レスポンスを使うほど早期に拾える設計。
 */
export function extractPayloadFromResult(result: CallToolResult): VrmPayload | null {
  const structuredPayload = pickVrmPayload(result.structuredContent)
  if (structuredPayload) return structuredPayload

  const metaPayload = pickVrmPayload((result as { _meta?: Record<string, unknown> })._meta)
  if (metaPayload) return metaPayload

  // resource コンテンツに blob/text が含まれている場合は base64 として吸収する。
  const resourceContent = result.content?.find((content) => {
    if (content.type !== 'resource') return false
    const resource: unknown = content.resource
    return isRecord(resource) && (typeof resource.blob === 'string' || typeof resource.text === 'string')
  })

  if (resourceContent?.type === 'resource') {
    const resource = resourceContent.resource
    if (isRecord(resource)) {
      return {
        vrmBase64: readString(resource, 'blob'),
        vrmMimeType: readString(resource, 'mimeType') ?? 'model/gltf-binary',
      }
    }
  }

  return parseJsonTextPayload(result)
}

// ツール呼び出し前の入力通知（params.arguments）からペイロードを推測する。
// 結果待ちの段階でプレビューを先行表示するために使う。
export function extractPayloadFromInput(params: McpUiToolInputNotification['params']): VrmPayload | null {
  return pickVrmPayload(params.arguments)
}

export function extractModelIdFromInput(params: McpUiToolInputNotification['params']): string | undefined {
  return isRecord(params.arguments) ? readString(params.arguments, 'modelId') : undefined
}

export interface PoseSegment {
  pose?: string
  text: string
  speedScale?: number
  explicitSpeedScale?: number
  prePhonemeLength?: number
  postPhonemeLength?: number
  audioBase64?: string
  speaker?: number
  speakerName?: string
  // VOICEVOX のモーラ／母音長情報。リップシンクの母音モードで参照する。
  audioQuery?: AudioQuery
}

function pickPoseSegments(source: unknown): PoseSegment[] | null {
  if (!isRecord(source)) return null
  const segments = source.segments
  if (!Array.isArray(segments)) return null
  const result: PoseSegment[] = []
  for (const segment of segments) {
    if (!isRecord(segment)) continue
    const text = readString(segment, 'text')
    if (!text) continue
    result.push({
      text,
      pose: readString(segment, 'pose'),
      speedScale: typeof segment.speedScale === 'number' ? segment.speedScale : undefined,
      explicitSpeedScale: typeof segment.explicitSpeedScale === 'number' ? segment.explicitSpeedScale : undefined,
      prePhonemeLength: typeof segment.prePhonemeLength === 'number' ? segment.prePhonemeLength : undefined,
      postPhonemeLength: typeof segment.postPhonemeLength === 'number' ? segment.postPhonemeLength : undefined,
      audioBase64: readString(segment, 'audioBase64'),
      speaker: typeof segment.speaker === 'number' ? segment.speaker : undefined,
      speakerName: readString(segment, 'speakerName'),
      audioQuery: isRecord(segment.audioQuery) ? (segment.audioQuery as unknown as AudioQuery) : undefined,
    })
  }
  return result.length > 0 ? result : null
}

/**
 * `speak_player` 結果からポーズ付きセグメント列を取り出す。
 * structuredContent → _meta → text(JSON) の順で探し、いずれにも無ければ null。
 */
export function extractPoseSegmentsFromResult(result: CallToolResult): PoseSegment[] | null {
  const fromStructured = pickPoseSegments(result.structuredContent)
  if (fromStructured) return fromStructured

  const meta = (result as { _meta?: Record<string, unknown> })._meta
  const fromMeta = pickPoseSegments(meta)
  if (fromMeta) return fromMeta

  const textContent = result.content?.find((content) => content.type === 'text')
  if (textContent?.type === 'text') {
    try {
      return pickPoseSegments(JSON.parse(textContent.text))
    } catch {
      return null
    }
  }

  return null
}
