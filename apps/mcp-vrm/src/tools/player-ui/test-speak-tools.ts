import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'
import { registerAppToolIfEnabled } from '../registration.js'
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
  const { server, disabledTools } = deps
  const { playerResourceUri, synthesizeWithCache } = shared

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
    async ({ speakerId, text }: { speakerId: number; text?: string }): Promise<CallToolResult> => {
      try {
        const finalText = (text ?? '').trim() || DEFAULT_TEST_TEXT
        const result = await synthesizeWithCache({
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
    async ({
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
    }): Promise<CallToolResult> => {
      try {
        const result = await synthesizeWithCache({
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
