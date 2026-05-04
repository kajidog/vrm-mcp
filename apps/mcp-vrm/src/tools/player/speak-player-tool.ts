import { randomUUID } from 'node:crypto'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'
import { getVrmModelUrl } from '../../vrm-http.js'
import { registerAppToolIfEnabled } from '../registration.js'
import type { ToolDeps } from '../types.js'
import { createErrorResponse } from '../utils.js'
import { playerResourceUri } from './runtime.js'
import type { PlayerRuntime } from './runtime.js'

interface SegmentInput {
  pose?: string
  text: string
  speedScale?: number
}

interface ResolvedSegment {
  text: string
  speaker: number
  speedScale?: number
  explicitSpeedScale?: number
  pose?: string
}

export function registerSpeakPlayerTool(deps: ToolDeps, runtime: PlayerRuntime): void {
  const { server, config, disabledTools, engine, capabilities } = deps

  registerAppToolIfEnabled(
    server,
    disabledTools,
    'speak_player',
    {
      title: 'Speak Player',
      description:
        'Creates a TTS player session UI. Provide segments [{ text, pose?, speedScale? }] and an optional modelId (falls back to the registered default; call list_vrms to discover IDs). The speaker is taken from the VRM model. Returns viewUUID. For simple playback without UI, use tts_speak instead.',
      inputSchema: {
        modelId: z
          .string()
          .optional()
          .describe('VRM model ID. Falls back to the registered default; errors if no default exists.'),
        segments: z
          .array(
            z.object({
              text: z.string().describe('Text spoken in this segment.'),
              pose: z.string().optional().describe('Pose preset ID (e.g. "idle", "wave", "bow"). Defaults to "idle".'),
              speedScale: z.number().optional().describe('Playback speed for this segment.'),
            })
          )
          .min(1)
          .describe('One or more spoken segments. The speaker is determined by the VRM model.'),
        speedScale: z
          .number()
          .optional()
          .describe('Default playback speed applied to segments without their own speedScale.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: { ui: { resourceUri: playerResourceUri } },
    },
    async ({
      modelId,
      segments,
      speedScale,
    }: {
      modelId?: string
      segments: SegmentInput[]
      speedScale?: number
    }): Promise<CallToolResult> => {
      try {
        const model = resolveVrmModel(runtime, modelId)
        const baseSegments: ResolvedSegment[] = segments.map((s, index) => {
          if (!s.text?.trim()) {
            throw new Error(`segments[${index}].text is required`)
          }
          const explicitSpeedScale = s.speedScale ?? speedScale
          return {
            text: s.text,
            speaker: model.speakerId,
            speedScale: explicitSpeedScale,
            explicitSpeedScale,
            pose: s.pose,
          }
        })

        const speakerNameMap = await runtime.resolveSpeakerNames([model.speakerId])
        const viewUUID = randomUUID()

        // 各セグメントを並列合成。失敗したセグメントは text のみ残し、UI側で順次フォールバック表示する。
        const synthesized = await Promise.all(
          baseSegments.map(async (s) => {
            try {
              const result = await runtime.synthesizeWithCache({
                text: s.text,
                speaker: s.speaker,
                speedScale: s.speedScale,
              })
              return {
                audioBase64: result.audioBase64 as string | undefined,
                speedScale: result.speedScale,
                prePhonemeLength: result.prePhonemeLength,
                postPhonemeLength: result.postPhonemeLength,
              }
            } catch (error) {
              console.warn('[speak_player] synthesize failed for segment:', error)
              return { audioBase64: undefined }
            }
          })
        )

        const nextState = {
          segments: baseSegments.map((s, index) => ({
            text: s.text,
            speaker: s.speaker,
            speakerName: speakerNameMap.get(s.speaker),
            speedScale: synthesized[index].speedScale ?? s.speedScale ?? config.defaultSpeedScale,
            ...(s.pose !== undefined ? { pose: s.pose } : {}),
          })),
          updatedAt: Date.now(),
        }
        runtime.setSessionState(viewUUID, nextState)

        const fullText = baseSegments.map((s) => s.text).join(' ')
        const textPreview = fullText.slice(0, 60) + (fullText.length > 60 ? '...' : '')
        const uiSegments = baseSegments.map((s, index) => ({
          text: s.text,
          speaker: s.speaker,
          speakerName: speakerNameMap.get(s.speaker),
          speedScale: synthesized[index].speedScale ?? s.speedScale ?? config.defaultSpeedScale,
          ...(s.explicitSpeedScale !== undefined ? { explicitSpeedScale: s.explicitSpeedScale } : {}),
          ...(synthesized[index].prePhonemeLength !== undefined
            ? { prePhonemeLength: synthesized[index].prePhonemeLength }
            : {}),
          ...(synthesized[index].postPhonemeLength !== undefined
            ? { postPhonemeLength: synthesized[index].postPhonemeLength }
            : {}),
          ...(s.pose !== undefined ? { pose: s.pose } : {}),
          ...(synthesized[index].audioBase64 ? { audioBase64: synthesized[index].audioBase64 } : {}),
        }))
        const structured: Record<string, unknown> = {
          viewUUID,
          autoPlay: config.autoPlay,
          segments: uiSegments,
          audioMimeType: 'audio/wav',
          engineId: engine.id,
          engineDisplayName: engine.displayName,
          capabilities,
          vrmModel: {
            id: model.id,
            name: model.name,
            speakerId: model.speakerId,
            vrmUrl: getVrmModelUrl(config, model.id),
          },
        }
        return {
          content: [
            {
              type: 'text',
              text: `TTS Player started. viewUUID: ${viewUUID} 「${textPreview}」\nNext: tts_resynthesize_player (edit a track) | tts_get_player_state (inspect state)`,
            },
          ],
          structuredContent: structured,
          _meta: { viewUUID },
        }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )
}

function resolveVrmModel(runtime: PlayerRuntime, modelId: string | undefined) {
  if (modelId) {
    const model = runtime.vrmRegistry.get(modelId)
    if (!model) throw new Error(`VRM model not found: ${modelId}`)
    return model
  }
  const defaultModel = runtime.vrmRegistry.getDefault()
  if (!defaultModel) {
    throw new Error('No default VRM is registered. Pass modelId or set a default via the registry.')
  }
  return defaultModel
}
