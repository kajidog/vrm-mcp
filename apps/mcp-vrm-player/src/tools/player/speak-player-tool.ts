import { randomUUID } from 'node:crypto'
import type { AudioQuery } from '@kajidog/tts-client'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'
import { getVrmModelUrl } from '../../vrm-http.js'
import { resolveUserId } from '../auth-context.js'
import { EMOTION_NAMES, type EmotionBinding, type EmotionName, normalizeEmotion } from '../emotions.js'
import { EMOTION_GUIDE, getRegistrationGuide } from '../guidance.js'
import { BUILTIN_POSE_IDS, isBuiltinPoseResourceId, toBuiltinPoseResourceId } from '../pose-registry/types.js'
import { registerAppToolIfEnabled } from '../registration.js'
import type { ToolDeps, ToolHandlerExtra } from '../types.js'
import { createErrorResponse } from '../utils.js'
import { playerResourceUri } from './runtime.js'
import type { PlayerRuntime } from './runtime.js'

interface SegmentInput {
  emotion?: string
  gaze?: 'camera' | 'away' | 'front'
  pose?: string
  speedScale?: number
  text: string
}

interface ResolvedSegment {
  text: string
  speaker: number
  speedScale?: number
  explicitSpeedScale?: number
  requestedPose?: string
  pose?: string
  poseFallbackReason?: string
  emotion: EmotionName
  gaze?: 'camera' | 'away' | 'front'
  expressionName?: string
  expressionWeight?: number
}

export function registerSpeakPlayerTool(deps: ToolDeps, runtime: PlayerRuntime): void {
  const { server, config, disabledTools, engine, capabilities } = deps

  registerAppToolIfEnabled(
    server,
    disabledTools,
    'speak_player',
    {
      title: 'Speak Player',
      description: `Creates the VRM TTS player UI for user conversation. Usually call vrm_start_here first. Provide segments [{ text, emotion?, pose?, gaze?, speedScale? }] and optional modelId; modelId falls back to the registered default. Use vrm_find_models to discover model IDs and pose names. Emotions are fixed values: ${EMOTION_GUIDE}. gaze is optional per segment: camera means eye contact, away means looking away from the camera, front means neutral forward gaze. speedScale is optional per segment and overrides player speed settings for that segment.`,
      inputSchema: {
        modelId: z.string().optional().describe('VRM model ID. Falls back to the registered default model.'),
        segments: z
          .array(
            z.object({
              text: z.string().describe('Text spoken in this segment.'),
              pose: z
                .string()
                .optional()
                .describe(
                  'Pose name from vrm_find_models models[].poses, or built-in pose name such as idle, wave, or bow. Defaults to idle.'
                ),
              emotion: z
                .enum(EMOTION_NAMES)
                .optional()
                .describe(`Emotion for this segment. Fixed values: ${EMOTION_GUIDE}.`),
              gaze: z
                .enum(['camera', 'away', 'front'])
                .optional()
                .describe(
                  'Eye gaze for this segment. camera = eye contact with the viewer, away = glance away from the camera, front = neutral forward gaze. Omit to keep the default camera gaze.'
                ),
              speedScale: z
                .number()
                .min(0.5)
                .max(2)
                .optional()
                .describe('Playback speed scale for this segment. Defaults to player settings.'),
            })
          )
          .min(1)
          .describe('One or more spoken segments. The speaker is determined by the VRM model.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: { ui: { resourceUri: playerResourceUri } },
    },
    async (
      {
        modelId,
        segments,
      }: {
        modelId?: string
        segments: SegmentInput[]
      },
      extra: ToolHandlerExtra
    ): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        const settings = runtime.playerSettings.applyDefaults({}, userId)
        const model = resolveVrmModel(runtime, userId, settings.usePublicVrms, modelId)
        if (!model) {
          const structured = {
            action: 'openModelManager',
            mode: 'register',
            displayed: true,
            registrationGuide: getRegistrationGuide(false),
          }
          return {
            content: [
              {
                type: 'text',
                text: `Model registration UI displayed. No modelId was specified and no default VRM model is registered.\n${structured.registrationGuide}`,
              },
            ],
            structuredContent: structured,
            _meta: structured,
          }
        }
        const baseSegments: ResolvedSegment[] = segments.map((s, index) => {
          if (!s.text?.trim()) {
            throw new Error(`segments[${index}].text is required`)
          }
          const emotion = normalizeEmotion(s.emotion)
          const binding = resolveEmotionBinding(model?.emotionBindings, emotion)
          const speaker = binding?.speakerId ?? model?.speakerId ?? config.defaultSpeaker
          const resolvedPose = resolveSegmentPose(runtime, model.poses, s.pose)
          return {
            text: s.text,
            speaker,
            speedScale: s.speedScale,
            explicitSpeedScale: s.speedScale,
            requestedPose: s.pose,
            pose: resolvedPose.pose,
            ...(resolvedPose.fallbackReason ? { poseFallbackReason: resolvedPose.fallbackReason } : {}),
            emotion,
            ...(s.gaze !== undefined ? { gaze: s.gaze } : {}),
            ...(binding?.expressionName ? { expressionName: binding.expressionName } : {}),
            ...(binding?.weight !== undefined ? { expressionWeight: binding.weight } : {}),
          }
        })

        const speakerNameMap = await runtime.resolveSpeakerNames(baseSegments.map((segment) => segment.speaker))
        const viewUUID = randomUUID()

        // 先頭だけ先行合成して、UI が最初の音声を取得できる状態になったら返す。
        // 2件目以降は `_get_player_audio_for_player` が必要になった順に合成する。
        const first = baseSegments[0]
        let firstSynthesized: {
          speedScale: number
          prePhonemeLength?: number
          postPhonemeLength?: number
          audioQuery?: AudioQuery
        }
        try {
          const result = await runtime.synthesizeWithCache({
            userId,
            text: first.text,
            speaker: first.speaker,
            speedScale: first.speedScale,
          })
          firstSynthesized = {
            speedScale: result.speedScale,
            prePhonemeLength: result.prePhonemeLength,
            postPhonemeLength: result.postPhonemeLength,
            audioQuery: result.audioQuery,
          }
        } catch (error) {
          throw new Error(
            `segments[0] の音声合成に失敗しました: ${error instanceof Error ? error.message : String(error)}`
          )
        }

        const nextState = {
          userId,
          segments: baseSegments.map((s, index) => ({
            text: s.text,
            speaker: s.speaker,
            speakerName: speakerNameMap.get(s.speaker),
            speedScale: index === 0 ? firstSynthesized.speedScale : (s.speedScale ?? settings.speedScale),
            ...(s.explicitSpeedScale !== undefined ? { explicitSpeedScale: s.explicitSpeedScale } : {}),
            ...(index === 0 && firstSynthesized.prePhonemeLength !== undefined
              ? { prePhonemeLength: firstSynthesized.prePhonemeLength }
              : {}),
            ...(index === 0 && firstSynthesized.postPhonemeLength !== undefined
              ? { postPhonemeLength: firstSynthesized.postPhonemeLength }
              : {}),
            ...(s.requestedPose !== undefined ? { requestedPose: s.requestedPose } : {}),
            ...(s.pose !== undefined ? { pose: s.pose } : {}),
            ...(s.poseFallbackReason !== undefined ? { poseFallbackReason: s.poseFallbackReason } : {}),
            emotion: s.emotion,
            ...(s.gaze !== undefined ? { gaze: s.gaze } : {}),
            ...(s.expressionName !== undefined ? { expressionName: s.expressionName } : {}),
            ...(s.expressionWeight !== undefined ? { expressionWeight: s.expressionWeight } : {}),
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
          speedScale: index === 0 ? firstSynthesized.speedScale : (s.speedScale ?? settings.speedScale),
          ...(s.explicitSpeedScale !== undefined ? { explicitSpeedScale: s.explicitSpeedScale } : {}),
          ...(index === 0 && firstSynthesized.prePhonemeLength !== undefined
            ? { prePhonemeLength: firstSynthesized.prePhonemeLength }
            : {}),
          ...(index === 0 && firstSynthesized.postPhonemeLength !== undefined
            ? { postPhonemeLength: firstSynthesized.postPhonemeLength }
            : {}),
          ...(s.requestedPose !== undefined ? { requestedPose: s.requestedPose } : {}),
          ...(s.pose !== undefined ? { pose: s.pose } : {}),
          ...(s.poseFallbackReason !== undefined ? { poseFallbackReason: s.poseFallbackReason } : {}),
          emotion: s.emotion,
          ...(s.gaze !== undefined ? { gaze: s.gaze } : {}),
          ...(s.expressionName !== undefined ? { expressionName: s.expressionName } : {}),
          ...(s.expressionWeight !== undefined ? { expressionWeight: s.expressionWeight } : {}),
        }))
        const structured: Record<string, unknown> = {
          viewUUID,
          autoPlay: settings.autoPlay,
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
                  emotionBindings: model.emotionBindings ?? [],
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
          _meta: { viewUUID, autoPlay: structured.autoPlay },
        }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )
}

function resolveEmotionBinding(
  bindings: EmotionBinding[] | undefined,
  emotion: EmotionName
): EmotionBinding | undefined {
  return bindings?.find((binding) => binding.emotion === emotion)
}

function resolveVrmModel(runtime: PlayerRuntime, userId: string, usePublicVrms: boolean, modelId: string | undefined) {
  if (modelId) {
    const model = runtime.vrmRegistry.getVisible(modelId, { userId, usePublicVrms })
    if (!model) throw new Error(`VRM model not found: ${modelId}`)
    return model
  }
  return runtime.vrmRegistry.getDefault(userId)
}

function resolveSegmentPose(
  runtime: PlayerRuntime,
  modelPoses: Array<{ poseId: string; name: string }> | undefined,
  requestedPose: string | undefined
): { pose: string; fallbackReason?: string } {
  const requested = requestedPose?.trim() || 'idle'
  const matches = (modelPoses ?? []).filter((pose) => pose.name === requested || pose.poseId === requested)
  const picked = matches[0]
  if (picked) {
    if (isBuiltinPoseResourceId(picked.poseId) || runtime.poseRegistry.get(picked.poseId)) {
      return { pose: picked.name }
    }
    return { pose: 'idle', fallbackReason: `Pose resource not found: ${requested}` }
  }

  if ((BUILTIN_POSE_IDS as readonly string[]).includes(requested)) {
    return { pose: requested }
  }
  if (isBuiltinPoseResourceId(requested)) {
    return { pose: requested.slice('builtin:'.length) }
  }

  const idleAttachment = (modelPoses ?? []).find((pose) => pose.poseId === toBuiltinPoseResourceId('idle'))
  return {
    pose: idleAttachment?.name ?? 'idle',
    fallbackReason: requestedPose?.trim() ? `Pose not available on model: ${requested}` : undefined,
  }
}
