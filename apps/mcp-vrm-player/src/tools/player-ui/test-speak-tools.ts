import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'
import { resolveUserId } from '../auth-context.js'
import { registerAppToolIfEnabled } from '../registration.js'
import type { ToolHandlerExtra } from '../types.js'
import { createErrorResponse } from '../utils.js'
import type { PlayerUIToolContext } from './context.js'

const DEFAULT_TEST_TEXT = 'こんにちは、これはテスト音声です。'

/**
 * Phase 3: VRM 登録/編集画面の「音声テスト」ボタン用ツール。
 *
 * speak_player を流用しないのは、合成テストは public な発話ツールとは責務が違い、
 * session-state への保存や viewUUID 発行など余計な副作用が走るのを避けるため。
 * 結果は base64 オーディオのみ返す。
 */
export function registerTestSpeakTools(context: PlayerUIToolContext): void {
  const { deps, shared } = context
  const { server, disabledTools, capabilities } = deps
  const { playerResourceUri, synthesizeWithCache, getSessionState } = shared
  // mora.consonant_length / vowel_length / pitch がエンジンから返らない場合
  // (例: AivisSpeech) は audioQuery を UI に渡さず、リップシンクを RMS フォールバックに任せる。
  const exposeAudioQueryToUi = capabilities.moraData

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_test_speak_for_player',
    {
      title: 'Test Speak (Player)',
      description:
        'Synthesize a short test phrase for the given speaker and return base64 audio. Only callable from the app UI.',
      inputSchema: {
        speakerId: z.number().describe('Speaker ID to use for synthesis'),
        text: z.string().optional().describe('Optional text. Defaults to a short test phrase.'),
      },
      _meta: {
        ui: { resourceUri: playerResourceUri, visibility: ['app'] },
      },
    },
    async (
      { speakerId, text }: { speakerId: number; text?: string },
      extra: ToolHandlerExtra
    ): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        const finalText = (text ?? '').trim() || DEFAULT_TEST_TEXT
        const result = await synthesizeWithCache({
          userId,
          text: finalText,
          speaker: speakerId,
        })
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                audioBase64: result.audioBase64,
                audioMimeType: 'audio/wav',
                text: finalText,
                speakerId,
                speakerName: result.speakerName,
              }),
            },
          ],
        }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  // speak_player の結果に audio を含めない代わりに、UI が viewUUID で
  // 各セグメントの base64 音声をまとめて取得するための内部ツール。
  // 1MB 制限に引っかからないよう、AI 向けの公開ツールではなく app-only にする。
  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_get_player_audio_for_player',
    {
      title: 'Get Player Audio (Player)',
      description:
        'Fetch base64 audio for one or all segments of a previously created speak_player view. Synthesis is cached per segment so repeated calls return immediately.',
      inputSchema: {
        viewUUID: z.string().min(1).describe('viewUUID returned by speak_player'),
        index: z.number().int().min(0).optional().describe('Segment index to fetch. Omit to fetch all segments.'),
      },
      _meta: {
        ui: { resourceUri: playerResourceUri, visibility: ['app'] },
      },
    },
    async (
      { viewUUID, index }: { viewUUID: string; index?: number },
      extra: ToolHandlerExtra
    ): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        const state = getSessionState(viewUUID)
        if (!state) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'session not found', viewUUID }),
              },
            ],
            isError: true,
          }
        }
        if (state.userId && state.userId !== userId) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'session not found', viewUUID }),
              },
            ],
            isError: true,
          }
        }

        if (index !== undefined && index >= state.segments.length) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'segment not found', viewUUID, index }),
              },
            ],
            isError: true,
          }
        }

        const targetSegments =
          index === undefined
            ? state.segments.map((segment, segmentIndex) => ({ segment, index: segmentIndex }))
            : [{ segment: state.segments[index], index }]
        const segments = await Promise.all(
          targetSegments.map(async ({ segment, index }) => {
            try {
              const result = await synthesizeWithCache({
                userId,
                text: segment.text,
                speaker: segment.speaker,
                audioQuery: segment.audioQuery,
                speedScale: segment.speedScale,
                intonationScale: segment.intonationScale,
                volumeScale: segment.volumeScale,
                prePhonemeLength: segment.prePhonemeLength,
                postPhonemeLength: segment.postPhonemeLength,
                pauseLengthScale: segment.pauseLengthScale,
                accentPhrases: segment.accentPhrases,
              })
              return {
                index,
                audioBase64: result.audioBase64,
                speedScale: result.speedScale,
                ...(exposeAudioQueryToUi ? { audioQuery: result.audioQuery } : {}),
                prePhonemeLength: result.prePhonemeLength,
                postPhonemeLength: result.postPhonemeLength,
              }
            } catch (error) {
              throw new Error(
                `segment ${index} の音声合成に失敗しました: ${error instanceof Error ? error.message : String(error)}`
              )
            }
          })
        )

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                viewUUID,
                audioMimeType: 'audio/wav',
                segments,
              }),
            },
          ],
        }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  // モデル切替時に既存セグメントを新しい話者で再合成するための内部ツール。
  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_resynthesize_for_player',
    {
      title: 'Resynthesize Segment (Player)',
      description:
        'Synthesize a single segment for the given text/speaker/speedScale. Used when the player swaps the displayed VRM and needs to re-render audio with the new speaker.',
      inputSchema: {
        speakerId: z.number().describe('Speaker ID to use for synthesis'),
        text: z.string().min(1).describe('Text to synthesize'),
        speedScale: z.number().optional().describe('Playback speed scale (defaults to server default)'),
        prePhonemeLength: z.number().optional().describe('Pre-phoneme silence length'),
        postPhonemeLength: z.number().optional().describe('Post-phoneme silence length'),
      },
      _meta: {
        ui: { resourceUri: playerResourceUri, visibility: ['app'] },
      },
    },
    async (
      {
        speakerId,
        text,
        speedScale,
        prePhonemeLength,
        postPhonemeLength,
      }: {
        speakerId: number
        text: string
        speedScale?: number
        prePhonemeLength?: number
        postPhonemeLength?: number
      },
      extra: ToolHandlerExtra
    ): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        const result = await synthesizeWithCache({
          userId,
          text,
          speaker: speakerId,
          speedScale,
          prePhonemeLength,
          postPhonemeLength,
        })
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                audioBase64: result.audioBase64,
                audioMimeType: 'audio/wav',
                text,
                speakerId,
                speakerName: result.speakerName,
                speedScale: result.speedScale,
                ...(exposeAudioQueryToUi ? { audioQuery: result.audioQuery } : {}),
                prePhonemeLength: result.prePhonemeLength,
                postPhonemeLength: result.postPhonemeLength,
              }),
            },
          ],
        }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )
}
