import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'
import { getVrmModelUrl } from '../../vrm-http.js'
import { resolveUserId } from '../auth-context.js'
import type { EmotionBinding } from '../emotions.js'
import { EMOTION_NAMES } from '../emotions.js'
import { DEFAULT_POSE_NAMES, getRegistrationGuide } from '../guidance.js'
import type { PlayerSettingsStore } from '../player/player-settings-store.js'
import type { PoseRegistryStore } from '../pose-registry/store.js'
import { isBuiltinPoseResourceId } from '../pose-registry/types.js'
import { registerAppToolIfEnabled, registerToolIfEnabled } from '../registration.js'
import type { ToolDeps, ToolHandlerExtra } from '../types.js'
import { createErrorResponse } from '../utils.js'
import type { VrmRegistryStore } from './store.js'
import type { VrmModel } from './types.js'

interface PublicVrmEntry {
  id: string
  name: string
  speakerId: number
  isDefault: boolean
  vrmUrl: string
  vrmSizeBytes: number
  updatedAt: number
  emotionBindings?: EmotionBinding[]
  poses: { id: string; name: string; loop: boolean }[]
}

export function registerVrmPublicTools(
  deps: ToolDeps,
  registry: VrmRegistryStore,
  poseRegistry: PoseRegistryStore,
  playerSettings?: PlayerSettingsStore
): void {
  const { server, disabledTools, config, ttsClient, engine } = deps

  registerToolIfEnabled(
    server,
    disabledTools,
    'start_here',
    {
      title: 'Start Here',
      description:
        'Call this first before using other vrm tools. Returns engine status, registered model summary, default model, default pose names, fixed emotion names, and player settings.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra): Promise<CallToolResult> => {
      try {
        const visibility = resolveVrmVisibility(playerSettings, extra)
        const health = await ttsClient.checkHealth()
        const models = registry.listVisible(visibility)
        const defaultModel = registry.getDefault(visibility.userId)
        const effectiveSettings = playerSettings?.applyDefaults({}, visibility.userId) ?? {
          autoPlay: config.autoPlay,
          speedScale: config.defaultSpeedScale,
          usePublicVrms: true,
        }
        const structured: Record<string, unknown> = {
          engine: {
            id: engine.id,
            displayName: engine.displayName,
            connected: health.connected,
            version: health.version,
            url: health.url,
          },
          modelsCount: models.length,
          defaultModel: defaultModel
            ? {
                modelId: defaultModel.id,
                name: defaultModel.name,
                poses: resolvePoseNames(defaultModel, poseRegistry),
              }
            : null,
          defaultPoses: DEFAULT_POSE_NAMES,
          emotions: EMOTION_NAMES,
          settings: {
            autoPlay: effectiveSettings.autoPlay,
            speedScale: effectiveSettings.speedScale,
          },
          next: models.length === 0 ? 'Call vrm_open_model_manager with knowsHowToUse: true.' : 'Use vrm_speak_player.',
          ...(models.length === 0 ? { registrationGuide: getRegistrationGuide(false) } : {}),
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured,
        }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerToolIfEnabled(
    server,
    disabledTools,
    'find_models',
    {
      title: 'Find VRM Models',
      description:
        'Find registered VRM models and valid pose names. Use this when the user asks for a specific model or before passing modelId/segments[].pose to speak_player.',
      inputSchema: {
        modelId: z.string().optional().describe('Exact VRM model ID to look up.'),
        query: z.string().optional().describe('Case-insensitive search text matched against model name or ID.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (
      { modelId, query }: { modelId?: string; query?: string },
      extra: ToolHandlerExtra
    ): Promise<CallToolResult> => {
      try {
        const visibility = resolveVrmVisibility(playerSettings, extra)
        const models = filterModels(registry.listVisible(visibility), modelId, query).map((model) => ({
          modelId: model.id,
          name: model.name,
          isDefault: model.ownerUserId === visibility.userId && model.isDefault,
          poses: resolvePoseNames(model, poseRegistry),
        }))
        const structured: Record<string, unknown> = {
          models,
          ...(models.length === 0
            ? {
                registrationGuide: getRegistrationGuide(false),
                next: 'Call vrm_open_model_manager with knowsHowToUse: true, then ask the user to register a VRM model.',
              }
            : {}),
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured,
        }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerAppToolIfEnabled(
    server,
    disabledTools,
    'open_model_manager',
    {
      title: 'Open Model Manager',
      description:
        'Open the VRM model registration/edit UI. Use only when the user needs to register or edit a model. If the user already knows the UI, pass knowsHowToUse: true.',
      inputSchema: {
        modelId: z.string().optional().describe('VRM model ID to edit. Omit to open the registration screen.'),
        knowsHowToUse: z.boolean().optional().describe('Set true to omit detailed registration instructions.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: { ui: { resourceUri: 'ui://speak-player/player.html' } },
    },
    async (
      {
        modelId,
        knowsHowToUse,
      }: {
        modelId?: string
        knowsHowToUse?: boolean
      },
      extra: ToolHandlerExtra
    ): Promise<CallToolResult> => {
      try {
        const visibility = resolveVrmVisibility(playerSettings, extra)
        if (modelId) {
          const model = registry.get(modelId)
          if (!model || model.ownerUserId !== visibility.userId) throw new Error(`VRM model not found: ${modelId}`)
        }
        const structured = {
          action: 'openModelManager',
          mode: modelId ? 'edit' : 'register',
          modelId,
          displayed: true,
          registrationGuide: getRegistrationGuide(knowsHowToUse),
        }
        return {
          content: [
            {
              type: 'text',
              text: `${modelId ? 'Model edit UI displayed.' : 'Model registration UI displayed.'}\n${structured.registrationGuide}`,
            },
          ],
          structuredContent: structured,
          _meta: structured,
        }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerToolIfEnabled(
    server,
    disabledTools,
    'list_vrms',
    {
      title: 'List VRMs',
      description:
        'List registered VRM models. Use this before calling speak_player to discover valid modelId values, model poses, and emotion bindings. Pass segments[].pose as one of poses[].name and segments[].emotion as neutral/happy/angry/sad/relaxed/surprised/serious. Returns metadata only (no binary).',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra): Promise<CallToolResult> => {
      try {
        const visibility = resolveVrmVisibility(playerSettings, extra)
        const entries: PublicVrmEntry[] = registry.listVisible(visibility).map((model) => ({
          id: model.id,
          name: model.name,
          speakerId: model.speakerId,
          isDefault: model.ownerUserId === visibility.userId && model.isDefault,
          vrmUrl: getVrmModelUrl(config, model.id),
          vrmSizeBytes: model.vrmSizeBytes,
          updatedAt: model.updatedAt,
          emotionBindings: model.emotionBindings,
          poses: (model.poses ?? []).flatMap((attachment) => {
            if (isBuiltinPoseResourceId(attachment.poseId)) {
              return [{ id: attachment.poseId, name: attachment.name, loop: true }]
            }
            const pose = poseRegistry.get(attachment.poseId)
            return pose ? [{ id: attachment.poseId, name: attachment.name, loop: pose.loop }] : []
          }),
        }))
        const summary =
          entries.length === 0 ? 'No VRM models registered.' : `${entries.length} VRM model(s) registered.`
        return {
          content: [
            {
              type: 'text',
              text: `${summary}\n${JSON.stringify({ vrms: entries }, null, 2)}`,
            },
          ],
          structuredContent: { vrms: entries },
        }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )
}

function filterModels(models: VrmModel[], modelId: string | undefined, query: string | undefined): VrmModel[] {
  if (modelId?.trim()) return models.filter((model) => model.id === modelId.trim())
  const needle = query?.trim().toLowerCase()
  if (!needle) return models
  return models.filter((model) => model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle))
}

function resolveVrmVisibility(playerSettings: PlayerSettingsStore | undefined, extra: ToolHandlerExtra | undefined) {
  const userId = resolveUserId(extra)
  const settings = playerSettings?.applyDefaults({}, userId)
  return { userId, usePublicVrms: settings?.usePublicVrms ?? true }
}

function resolvePoseNames(model: VrmModel, poseRegistry: PoseRegistryStore): string[] {
  return (model.poses ?? []).flatMap((attachment) => {
    if (isBuiltinPoseResourceId(attachment.poseId)) return [attachment.name]
    return poseRegistry.get(attachment.poseId) ? [attachment.name] : []
  })
}
