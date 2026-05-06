import { randomUUID } from 'node:crypto'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'
import { getVrmModelUrl } from '../../vrm-http.js'
import { isBuiltinPoseResourceId } from '../pose-registry/types.js'
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
        'Creates a TTS player session UI. Provide segments [{ text, pose?, speedScale? }] and an optional modelId (falls back to the registered default; call list_vrms to discover IDs and pose names). The speaker is taken from the VRM model. Returns viewUUID. For simple playback without UI, use tts_speak instead.',
      inputSchema: {
        modelId: z
          .string()
          .optional()
          .describe('VRM model ID. Falls back to the registered default; otherwise uses the CLI default speaker.'),
        segments: z
          .array(
            z.object({
              text: z.string().describe('Text spoken in this segment.'),
              pose: z
                .string()
                .optional()
                .describe(
                  'Pose name from list_vrms vrms[].poses[].name, or legacy preset ID (idle, wave, bow). Defaults to idle.'
                ),
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
        const speakerId = model?.speakerId ?? config.defaultSpeaker
        const baseSegments: ResolvedSegment[] = segments.map((s, index) => {
          if (!s.text?.trim()) {
            throw new Error(`segments[${index}].text is required`)
          }
          const explicitSpeedScale = s.speedScale ?? speedScale
          return {
            text: s.text,
            speaker: speakerId,
            speedScale: explicitSpeedScale,
            explicitSpeedScale,
            pose: s.pose,
          }
        })

        const speakerNameMap = await runtime.resolveSpeakerNames([speakerId])
        const viewUUID = randomUUID()

        // 各セグメントを並列合成し、結果は audio キャッシュに格納するだけ。
        // 音声バイナリはこのレスポンスには含めず、UI 側が viewUUID で
        // `_get_player_audio_for_player` を呼んで取得する（1MB 制限回避）。
        const synthesized = await Promise.all(
          baseSegments.map(async (s) => {
            try {
              const result = await runtime.synthesizeWithCache({
                text: s.text,
                speaker: s.speaker,
                speedScale: s.speedScale,
              })
              return {
                speedScale: result.speedScale,
                prePhonemeLength: result.prePhonemeLength,
                postPhonemeLength: result.postPhonemeLength,
                audioQuery: result.audioQuery,
              }
            } catch (error) {
              console.warn('[speak_player] synthesize failed for segment:', error)
              return {}
            }
          })
        )

        const nextState = {
          segments: baseSegments.map((s, index) => ({
            text: s.text,
            speaker: s.speaker,
            speakerName: speakerNameMap.get(s.speaker),
            speedScale: synthesized[index].speedScale ?? s.speedScale ?? config.defaultSpeedScale,
            ...(synthesized[index].prePhonemeLength !== undefined
              ? { prePhonemeLength: synthesized[index].prePhonemeLength }
              : {}),
            ...(synthesized[index].postPhonemeLength !== undefined
              ? { postPhonemeLength: synthesized[index].postPhonemeLength }
              : {}),
            ...(synthesized[index].audioQuery !== undefined ? { audioQuery: synthesized[index].audioQuery } : {}),
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
        }))
        const structured: Record<string, unknown> = {
          viewUUID,
          autoPlay: config.autoPlay,
          segments: uiSegments,
          audioMimeType: 'audio/wav',
          engineId: engine.id,
          engineDisplayName: engine.displayName,
          capabilities,
          ...(model ? { resolvedModelId: model.id } : {}),
          ...(model
            ? {
                vrmModel: {
                  id: model.id,
                  name: model.name,
                  speakerId: model.speakerId,
                  vrmUrl: getVrmModelUrl(config, model.id),
                  poses: (model.poses ?? []).flatMap((attachment) => {
                    if (isBuiltinPoseResourceId(attachment.poseId)) {
                      return [{ id: attachment.poseId, name: attachment.name, loop: true }]
                    }
                    const pose = runtime.poseRegistry.get(attachment.poseId)
                    return pose ? [{ id: attachment.poseId, name: attachment.name, loop: pose.loop }] : []
                  }),
                },
              }
            : {}),
        }
        return {
          content: [
            {
              type: 'text',
              text: `TTS Player started. viewUUID: ${viewUUID} 「${textPreview}」\nNext: tts_resynthesize_player (edit a track) | tts_get_player_state (inspect state)`,
            },
          ],
          structuredContent: structured,
          _meta: { viewUUID, autoPlay: config.autoPlay },
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
  return runtime.vrmRegistry.getDefault()
}
