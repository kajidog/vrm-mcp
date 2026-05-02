import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { DictionaryData, MultiPlayerData, PlayerData } from './types'

export function extractPlayerData(result: CallToolResult): PlayerData | null {
  const textContent = result.content?.find((c: { type: string }) => c.type === 'text')
  if (!textContent || textContent.type !== 'text') return null

  try {
    const data = JSON.parse(textContent.text)
    if (!data.audioBase64) return null
    return {
      audioBase64: data.audioBase64,
      text: data.text || '',
      autoPlay: data.autoPlay !== false,
      speaker: data.speaker ?? 0,
      speakerName: data.speakerName || `Speaker ${data.speaker}`,
      kana: typeof data.kana === 'string' ? data.kana : undefined,
      speedScale: data.speedScale,
      audioQuery: typeof data.audioQuery === 'object' && data.audioQuery ? data.audioQuery : undefined,
    }
  } catch {
    return null
  }
}

export function extractMultiPlayerData(result: CallToolResult): MultiPlayerData | null {
  // content からセグメント配列を試みる（後方互換）
  const textContent = result.content?.find((c: { type: string }) => c.type === 'text')
  if (textContent?.type === 'text') {
    try {
      const data = JSON.parse(textContent.text)
      if (data.segments && Array.isArray(data.segments)) {
        return {
          segments: data.segments,
          autoPlay: data.autoPlay !== false,
          viewUUID: typeof data.viewUUID === 'string' ? data.viewUUID : undefined,
          engineId: typeof data.engineId === 'string' ? data.engineId : undefined,
          engineDisplayName: typeof data.engineDisplayName === 'string' ? data.engineDisplayName : undefined,
          capabilities: typeof data.capabilities === 'object' && data.capabilities ? data.capabilities : undefined,
        }
      }
    } catch {
      // JSON でない場合（例: "TTS Player started. ..."）は _meta にフォールバック
    }
  }

  // _meta からセグメント配列を読む（speak_player / resynthesize_player の新形式）
  const meta = (result as { _meta?: Record<string, unknown> })?._meta
  if (meta?.segments && Array.isArray(meta.segments)) {
    return {
      segments: meta.segments as MultiPlayerData['segments'],
      autoPlay: meta.autoPlay !== false,
      viewUUID: typeof meta.viewUUID === 'string' ? meta.viewUUID : undefined,
      engineId: typeof meta.engineId === 'string' ? meta.engineId : undefined,
      engineDisplayName: typeof meta.engineDisplayName === 'string' ? meta.engineDisplayName : undefined,
      capabilities: typeof meta.capabilities === 'object' && meta.capabilities ? meta.capabilities as MultiPlayerData['capabilities'] : undefined,
    }
  }

  return null
}

export function extractDictionaryData(result: CallToolResult): DictionaryData | null {
  const meta = (result as { _meta?: Record<string, unknown> })?._meta
  if (meta?.mode === 'dictionary' && Array.isArray(meta.dictionaryWords)) {
    return {
      words: meta.dictionaryWords as DictionaryData['words'],
      notice: typeof meta.dictionaryNotice === 'string' ? meta.dictionaryNotice : undefined,
    }
  }

  const textContent = result.content?.find((c: { type: string }) => c.type === 'text')
  if (textContent?.type !== 'text') return null

  try {
    const data = JSON.parse(textContent.text) as { words?: DictionaryData['words']; notice?: string }
    if (!Array.isArray(data.words)) return null
    return {
      words: data.words,
      notice: typeof data.notice === 'string' ? data.notice : undefined,
    }
  } catch {
    return null
  }
}

/** 秒を mm:ss 形式に変換 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
