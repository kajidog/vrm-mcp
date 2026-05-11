import type { App } from '@modelcontextprotocol/ext-apps'
import type { PoseSegment } from '../utils/vrmPayload'
import { fetchSegmentsAudioOnServer } from './vrmPlayerToolClient'

export async function mergeSegmentAudioIndexes(
  app: App,
  segments: PoseSegment[],
  viewUUID: string,
  indexes: number[],
  onProgress?: (progress: number) => void
): Promise<PoseSegment[]> {
  onProgress?.(65)
  const audioResults = await Promise.all(indexes.map((index) => fetchSegmentsAudioOnServer(app, viewUUID, index)))
  onProgress?.(95)

  const byIndex = new Map(audioResults.flatMap((result) => result.segments).map((entry) => [entry.index, entry]))
  return segments.map((segment, index) => {
    const entry = byIndex.get(index)
    if (!entry) return segment
    if (!entry?.audioBase64) {
      throw new Error(`セグメント ${index + 1} の音声データを取得できませんでした。`)
    }
    return {
      ...segment,
      audioBase64: entry.audioBase64,
      audioMimeType: entry.audioMimeType ?? segment.audioMimeType,
      speedScale: entry.speedScale ?? segment.speedScale,
      audioQuery: entry.audioQuery ?? segment.audioQuery,
      prePhonemeLength: entry.prePhonemeLength ?? segment.prePhonemeLength,
      postPhonemeLength: entry.postPhonemeLength ?? segment.postPhonemeLength,
    }
  })
}

export async function mergeSegmentAudio(
  app: App,
  segments: PoseSegment[],
  viewUUID: string,
  onProgress?: (progress: number) => void
): Promise<PoseSegment[]> {
  return mergeSegmentAudioIndexes(
    app,
    segments,
    viewUUID,
    segments.map((_, index) => index),
    onProgress
  )
}

export function ensurePlayableSegments(segments: PoseSegment[], viewUUID: string | undefined): void {
  segments.forEach((segment, index) => {
    if (!segment.audioBase64) {
      throw new Error(
        viewUUID
          ? `セグメント ${index + 1} の音声データを取得できませんでした。`
          : '音声取得に必要な viewUUID が tool result に含まれていません。'
      )
    }
  })
}
