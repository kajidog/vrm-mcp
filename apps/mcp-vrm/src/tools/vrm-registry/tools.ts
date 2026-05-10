import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'
import { getVrmModelUrl } from '../../vrm-http.js'
import { resolveUserId } from '../auth-context.js'
import { EMOTION_NAMES, type EmotionBinding, isEmotionName } from '../emotions.js'
import type { PlayerUIToolContext } from '../player-ui/context.js'
import type { PoseRegistryStore } from '../pose-registry/store.js'
import type { ModelPoseAttachment } from '../pose-registry/types.js'
import { isBuiltinPoseResourceId } from '../pose-registry/types.js'
import { registerAppToolIfEnabled } from '../registration.js'
import type { ToolHandlerExtra } from '../types.js'
import { createErrorResponse } from '../utils.js'
import type { VrmRegistryStore } from './store.js'
import type { VrmModel } from './types.js'

function toMetadataPayload(model: VrmModel, userId?: string): Omit<VrmModel, 'vrmFilePath'> & { canEdit?: boolean } {
  // 内部のファイルパスは UI に出さない（パス露出と iframe からのアクセス不可のため）。
  const { vrmFilePath: _vrmFilePath, ...rest } = model
  return userId
    ? { ...rest, isDefault: model.ownerUserId === userId && model.isDefault, canEdit: model.ownerUserId === userId }
    : rest
}

function validateAttachments(
  poseRegistry: PoseRegistryStore,
  userId: string,
  poses: ModelPoseAttachment[] | undefined
): void {
  if (poses === undefined) return
  for (const pose of poses) {
    if (!pose.poseId.trim()) throw new Error('poses[].poseId is required')
    if (!pose.name.trim()) throw new Error('poses[].name is required')
    if (isBuiltinPoseResourceId(pose.poseId)) continue
    if (!poseRegistry.getOwned(pose.poseId, userId)) throw new Error(`Pose not found: ${pose.poseId}`)
  }
}

const emotionBindingSchema = z.object({
  emotion: z.enum(EMOTION_NAMES),
  expressionName: z.string().optional(),
  speakerId: z.number().optional(),
  weight: z.number().min(0).max(1).optional(),
})

function validateEmotionBindings(bindings: EmotionBinding[] | undefined): void {
  if (bindings === undefined) return
  const seen = new Set<string>()
  for (const binding of bindings) {
    if (!isEmotionName(binding.emotion)) throw new Error(`Unknown emotion: ${binding.emotion}`)
    if (seen.has(binding.emotion)) throw new Error(`Duplicate emotion binding: ${binding.emotion}`)
    seen.add(binding.emotion)
    if (binding.expressionName !== undefined && !binding.expressionName.trim()) {
      throw new Error('emotionBindings[].expressionName must not be empty')
    }
    if (binding.weight !== undefined && (binding.weight < 0 || binding.weight > 1)) {
      throw new Error('emotionBindings[].weight must be between 0 and 1')
    }
  }
}

async function loadConfiguredDefaultVrm(
  configuredPath: string
): Promise<{ vrmBase64: string; sourcePath: string } | null> {
  const trimmed = configuredPath.trim()
  if (!trimmed) return null
  const filePath = resolve(trimmed)
  if (!existsSync(filePath)) {
    throw new Error(
      `Default VRM file not found: ${filePath}. Set TTS_PLAYER_DEFAULT_VRM_PATH or --player-default-vrm-path.`
    )
  }
  const data = await readFile(filePath)
  return { vrmBase64: data.toString('base64'), sourcePath: filePath }
}

export function registerVrmRegistryTools(
  context: PlayerUIToolContext,
  registry: VrmRegistryStore,
  poseRegistry: PoseRegistryStore
): void {
  const { deps, shared } = context
  const { server, disabledTools, config } = deps
  const { playerResourceUri } = shared

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_list_vrms_for_player',
    {
      title: 'List VRMs (Player)',
      description: 'List registered VRM models (metadata only). Only callable from the app UI.',
      _meta: {
        ui: { resourceUri: playerResourceUri, visibility: ['app'] },
      },
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        const settings = shared.playerSettings.applyDefaults({}, userId)
        const list = registry
          .listVisible({ userId, usePublicVrms: settings.usePublicVrms })
          .map((model) => toMetadataPayload(model, userId))
        return { content: [{ type: 'text', text: JSON.stringify({ vrms: list }) }] }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_get_vrm_for_player',
    {
      title: 'Get VRM (Player)',
      description: 'Get a registered VRM binary as base64. Only callable from the app UI.',
      inputSchema: {
        modelId: z.string().describe('VRM model ID'),
      },
      _meta: {
        ui: { resourceUri: playerResourceUri, visibility: ['app'] },
      },
    },
    async ({ modelId }: { modelId: string }, extra: ToolHandlerExtra): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        const settings = shared.playerSettings.applyDefaults({}, userId)
        const model = registry.getVisible(modelId, { userId, usePublicVrms: settings.usePublicVrms })
        if (!model) throw new Error(`VRM not found: ${modelId}`)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                metadata: toMetadataPayload(model, userId),
                vrmUrl: getVrmModelUrl(config, model.id),
                vrmMimeType: 'model/gltf-binary',
              }),
            },
          ],
        }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_register_vrm_for_player',
    {
      title: 'Register VRM (Player)',
      description: 'Register a new VRM model. Only callable from the app UI.',
      inputSchema: {
        name: z.string().min(1).describe('Display name'),
        speakerId: z.number().describe('Speaker ID used when this VRM speaks via speak_player'),
        isDefault: z.boolean().optional().describe('Set as the global default VRM'),
        isPublic: z.boolean().optional().describe('Mark as public (reserved for future use)'),
        poses: z.array(z.object({ poseId: z.string(), name: z.string() })).optional(),
        emotionBindings: z.array(emotionBindingSchema).optional(),
        vrmBase64: z.string().min(1).describe('VRM/GLB file content encoded as base64'),
      },
      _meta: {
        ui: { resourceUri: playerResourceUri, visibility: ['app'] },
      },
    },
    async (
      input: {
        name: string
        speakerId: number
        isDefault?: boolean
        isPublic?: boolean
        poses?: ModelPoseAttachment[]
        emotionBindings?: EmotionBinding[]
        vrmBase64: string
      },
      extra: ToolHandlerExtra
    ): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        validateAttachments(poseRegistry, userId, input.poses)
        validateEmotionBindings(input.emotionBindings)
        const model = await registry.register({ ...input, ownerUserId: userId })
        return { content: [{ type: 'text', text: JSON.stringify({ vrm: toMetadataPayload(model, userId) }) }] }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_update_vrm_for_player',
    {
      title: 'Update VRM (Player)',
      description: 'Update VRM metadata (name, speakerId, isDefault, isPublic). Only callable from the app UI.',
      inputSchema: {
        modelId: z.string().describe('VRM model ID'),
        name: z.string().optional(),
        speakerId: z.number().optional(),
        isDefault: z.boolean().optional(),
        isPublic: z.boolean().optional(),
        poses: z.array(z.object({ poseId: z.string(), name: z.string() })).optional(),
        emotionBindings: z.array(emotionBindingSchema).optional(),
      },
      _meta: {
        ui: { resourceUri: playerResourceUri, visibility: ['app'] },
      },
    },
    async (
      input: {
        modelId: string
        name?: string
        speakerId?: number
        isDefault?: boolean
        isPublic?: boolean
        poses?: ModelPoseAttachment[]
        emotionBindings?: EmotionBinding[]
      },
      extra: ToolHandlerExtra
    ): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        const { modelId, ...fields } = input
        validateAttachments(poseRegistry, userId, fields.poses)
        validateEmotionBindings(fields.emotionBindings)
        const model = registry.update(modelId, fields, userId)
        return { content: [{ type: 'text', text: JSON.stringify({ vrm: toMetadataPayload(model, userId) }) }] }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_replace_vrm_binary_for_player',
    {
      title: 'Replace VRM Binary (Player)',
      description: 'Replace the VRM binary for a registered model. Only callable from the app UI.',
      inputSchema: {
        modelId: z.string().describe('VRM model ID'),
        vrmBase64: z.string().min(1).describe('VRM/GLB file content encoded as base64'),
      },
      _meta: {
        ui: { resourceUri: playerResourceUri, visibility: ['app'] },
      },
    },
    async (input: { modelId: string; vrmBase64: string }, extra: ToolHandlerExtra): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        const model = await registry.replaceBinary(input.modelId, input.vrmBase64, userId)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                vrm: toMetadataPayload(model, userId),
                vrmUrl: getVrmModelUrl(config, model.id),
              }),
            },
          ],
        }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_delete_vrm_for_player',
    {
      title: 'Delete VRM (Player)',
      description: 'Delete a registered VRM model and its binary. Only callable from the app UI.',
      inputSchema: {
        modelId: z.string().describe('VRM model ID'),
      },
      _meta: {
        ui: { resourceUri: playerResourceUri, visibility: ['app'] },
      },
    },
    async ({ modelId }: { modelId: string }, extra: ToolHandlerExtra): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        await registry.delete(modelId, userId)
        return { content: [{ type: 'text', text: JSON.stringify({ deleted: modelId }) }] }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_resolve_default_vrm_for_player',
    {
      title: 'Resolve Default VRM (Player)',
      description:
        'Resolve the effective default VRM. Priority: registry default → configured fallback path → none. Only callable from the app UI.',
      _meta: {
        ui: { resourceUri: playerResourceUri, visibility: ['app'] },
      },
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        const defaultModel = registry.getDefault(userId)
        if (defaultModel) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  source: 'registry',
                  metadata: toMetadataPayload(defaultModel, userId),
                  vrmUrl: getVrmModelUrl(config, defaultModel.id),
                  vrmMimeType: 'model/gltf-binary',
                }),
              },
            ],
          }
        }
        const fallback = await loadConfiguredDefaultVrm(config.playerDefaultVrmPath)
        if (fallback) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  source: 'config',
                  vrmBase64: fallback.vrmBase64,
                  vrmMimeType: 'model/gltf-binary',
                  sourcePath: fallback.sourcePath,
                }),
              },
            ],
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify({ source: 'none' }) }] }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )
}
