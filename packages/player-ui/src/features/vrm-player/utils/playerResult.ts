import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { EmotionBinding } from '~/features/emotions'
import type { ModelPoseAttachment } from '~/features/poses/types'

const PLAYED_KEY_PREFIX = 'vrm-played-'
const PLAYED_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function extractErrorMessage(result: CallToolResult): string {
  const text = result.content?.find((content) => content.type === 'text')
  return text?.type === 'text' ? text.text : 'Unknown error'
}

export function isPlayerToolResult(result: CallToolResult): boolean {
  const structured = result.structuredContent as Record<string, unknown> | undefined
  const meta = (result as { _meta?: Record<string, unknown> })._meta
  return Boolean(
    structured?.viewUUID ||
      structured?.segments ||
      structured?.vrmBase64 ||
      structured?.vrmResourceUri ||
      structured?.vrmModel ||
      meta?.viewUUID ||
      meta?.segments ||
      meta?.vrmBase64 ||
      meta?.vrmResourceUri ||
      meta?.vrmModel
  )
}

export function readDataUrl(record: Record<string, unknown>): string | undefined {
  if (typeof record.thumbnailUrl === 'string' && record.thumbnailUrl.trim()) return record.thumbnailUrl
  if (typeof record.thumbnailBase64 !== 'string' || !record.thumbnailBase64.trim()) return undefined
  const mimeType =
    typeof record.thumbnailMimeType === 'string' && record.thumbnailMimeType.trim()
      ? record.thumbnailMimeType
      : 'image/png'
  return `data:${mimeType};base64,${record.thumbnailBase64}`
}

export function readToolMeta(result: CallToolResult): Record<string, unknown> {
  const structured = result.structuredContent
  const meta = (result as { _meta?: Record<string, unknown> })._meta
  return {
    ...(structured && typeof structured === 'object' ? (structured as Record<string, unknown>) : {}),
    ...(meta && typeof meta === 'object' ? meta : {}),
  }
}

export function readModelManagerRequest(
  result: CallToolResult
): { mode: 'register' | 'edit'; modelId: string | null } | null {
  const meta = readToolMeta(result)
  if (meta.action !== 'openModelManager') return null
  const mode = meta.mode === 'edit' ? 'edit' : 'register'
  const modelId = typeof meta.modelId === 'string' && meta.modelId.trim() ? meta.modelId : null
  return { mode, modelId }
}

export function readModelPoses(value: unknown): ModelPoseAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const poses = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    if (typeof record.id === 'string' && typeof record.name === 'string') {
      return [{ poseId: record.id, name: record.name }]
    }
    if (typeof record.poseId === 'string' && typeof record.name === 'string') {
      return [{ poseId: record.poseId, name: record.name }]
    }
    return []
  })

  return poses.length > 0 ? poses : undefined
}

export function readEmotionBindings(value: unknown): EmotionBinding[] | undefined {
  if (!Array.isArray(value)) return undefined
  const bindings = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    if (typeof record.emotion !== 'string') return []
    return [
      {
        emotion: record.emotion as EmotionBinding['emotion'],
        expressionName: typeof record.expressionName === 'string' ? record.expressionName : undefined,
        speakerId: typeof record.speakerId === 'number' ? record.speakerId : undefined,
        weight: typeof record.weight === 'number' ? record.weight : undefined,
      },
    ]
  })
  return bindings.length > 0 ? bindings : undefined
}

export function consumeAutoPlay(meta: Record<string, unknown>): boolean {
  const wantedAutoPlay = meta.autoPlay !== false
  const viewUUID = typeof meta.viewUUID === 'string' && meta.viewUUID.trim() ? meta.viewUUID : undefined
  if (!viewUUID) return wantedAutoPlay

  try {
    const key = `${PLAYED_KEY_PREFIX}${viewUUID}`
    const restored = localStorage.getItem(key) !== null
    if (!restored) {
      localStorage.setItem(key, JSON.stringify({ playedAt: Date.now() }))
    }
    return wantedAutoPlay && !restored
  } catch {
    return wantedAutoPlay
  }
}

export function cleanupPlayedKeys(): void {
  try {
    const now = Date.now()
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(PLAYED_KEY_PREFIX)) continue
      const raw = localStorage.getItem(key)
      let playedAt = 0
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { playedAt?: unknown }
          playedAt = typeof parsed.playedAt === 'number' ? parsed.playedAt : 0
        } catch {
          playedAt = 0
        }
      }
      if (!playedAt || now - playedAt > PLAYED_KEY_TTL_MS) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    // localStorage が使えない環境では何もしない。
  }
}
