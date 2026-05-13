import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'
import { getPoseVrmaUrl } from '../../vrm-http.js'
import { resolveUserId } from '../auth-context.js'
import type { PlayerUIToolContext } from '../player-ui/context.js'
import { registerAppToolIfEnabled } from '../registration.js'
import type { ToolHandlerExtra } from '../types.js'
import { createErrorResponse } from '../utils.js'
import type { VrmRegistryStore } from '../vrm-registry/store.js'
import type { PoseRegistryStore } from './store.js'
import { BUILTIN_POSE_IDS, isBuiltinPoseResourceId, toBuiltinPoseResourceId } from './types.js'
import type { PoseResource } from './types.js'

export interface PoseMetadata {
  id: string
  name?: string
  loop: boolean
  sizeBytes: number
  vrmaUrl?: string
  builtin?: boolean
  createdAt?: number
  updatedAt?: number
}

export function builtinPoseMetadata(): PoseMetadata[] {
  return BUILTIN_POSE_IDS.map((id) => ({
    id: toBuiltinPoseResourceId(id),
    name: id,
    loop: true,
    sizeBytes: 0,
    builtin: true,
  }))
}

export function toPoseMetadata(
  config: PlayerUIToolContext['deps']['config'],
  pose: PoseResource,
  userId?: string
): PoseMetadata {
  return {
    id: pose.id,
    name: pose.name,
    loop: pose.loop,
    sizeBytes: pose.vrmaSizeBytes,
    vrmaUrl: getPoseVrmaUrl(config, pose.id, { userId }),
    createdAt: pose.createdAt,
    updatedAt: pose.updatedAt,
  }
}

export function assertPoseExists(poseRegistry: PoseRegistryStore, poseId: string): void {
  if (isBuiltinPoseResourceId(poseId)) return
  if (!poseRegistry.get(poseId)) throw new Error(`Pose not found: ${poseId}`)
}

export function registerPoseRegistryTools(
  context: PlayerUIToolContext,
  poseRegistry: PoseRegistryStore,
  vrmRegistry: VrmRegistryStore
): void {
  const { deps, shared } = context
  const { server, disabledTools, config } = deps
  const { playerResourceUri } = shared

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_list_poses_for_player',
    {
      title: 'List Poses (Player)',
      description: 'List registered pose resources plus builtin poses. Only callable from the app UI.',
      _meta: { ui: { resourceUri: playerResourceUri, visibility: ['app'] } },
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        const poses = [
          ...builtinPoseMetadata(),
          ...poseRegistry.listOwned(userId).map((pose) => toPoseMetadata(config, pose, userId)),
        ]
        return { content: [{ type: 'text', text: JSON.stringify({ poses }) }] }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_get_pose_for_player',
    {
      title: 'Get Pose (Player)',
      description: 'Get a registered pose resource URL. Builtin poses have no VRMA URL.',
      inputSchema: { poseId: z.string().describe('Pose resource ID') },
      _meta: { ui: { resourceUri: playerResourceUri, visibility: ['app'] } },
    },
    async ({ poseId }: { poseId: string }, extra: ToolHandlerExtra): Promise<CallToolResult> => {
      try {
        if (isBuiltinPoseResourceId(poseId)) {
          return {
            content: [
              { type: 'text', text: JSON.stringify({ pose: builtinPoseMetadata().find((p) => p.id === poseId) }) },
            ],
          }
        }
        const userId = resolveUserId(extra)
        const settings = shared.playerSettings.applyDefaults({}, userId)
        const pose = getReadablePose(poseRegistry, vrmRegistry, poseId, userId, settings.usePublicVrms)
        if (!pose) throw new Error(`Pose not found: ${poseId}`)
        return { content: [{ type: 'text', text: JSON.stringify({ pose: toPoseMetadata(config, pose, userId) }) }] }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_register_pose_for_player',
    {
      title: 'Register Pose (Player)',
      description: 'Register a new VRMA pose resource. Only callable from the app UI.',
      inputSchema: {
        id: z.string().min(1).describe('Unique pose ID. /^[A-Za-z0-9_-]{1,64}$/; builtin: is reserved.'),
        name: z.string().optional(),
        vrmaBase64: z.string().min(1).describe('VRMA/GLB file content encoded as base64'),
        loop: z.boolean().describe('Whether the animation should loop'),
      },
      _meta: { ui: { resourceUri: playerResourceUri, visibility: ['app'] } },
    },
    async (
      input: { id: string; name?: string; vrmaBase64: string; loop: boolean },
      extra: ToolHandlerExtra
    ): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        const pose = await poseRegistry.register({ ...input, ownerUserId: userId })
        return { content: [{ type: 'text', text: JSON.stringify({ pose: toPoseMetadata(config, pose, userId) }) }] }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_update_pose_for_player',
    {
      title: 'Update Pose (Player)',
      description: 'Update pose metadata. Only callable from the app UI.',
      inputSchema: { poseId: z.string(), name: z.string().optional(), loop: z.boolean().optional() },
      _meta: { ui: { resourceUri: playerResourceUri, visibility: ['app'] } },
    },
    async (
      input: { poseId: string; name?: string; loop?: boolean },
      extra: ToolHandlerExtra
    ): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        if (isBuiltinPoseResourceId(input.poseId)) throw new Error('Builtin poses cannot be updated')
        const pose = poseRegistry.update(input.poseId, { name: input.name, loop: input.loop }, userId)
        return { content: [{ type: 'text', text: JSON.stringify({ pose: toPoseMetadata(config, pose, userId) }) }] }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_delete_pose_for_player',
    {
      title: 'Delete Pose (Player)',
      description: 'Delete a registered pose resource if no VRM model attaches it.',
      inputSchema: { poseId: z.string() },
      _meta: { ui: { resourceUri: playerResourceUri, visibility: ['app'] } },
    },
    async ({ poseId }: { poseId: string }, extra: ToolHandlerExtra): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        if (isBuiltinPoseResourceId(poseId)) throw new Error('Builtin poses cannot be deleted')
        if (!poseRegistry.getOwned(poseId, userId)) throw new Error(`Pose not found: ${poseId}`)
        const referencing = vrmRegistry
          .list()
          .filter((model) => model.ownerUserId === userId && model.poses?.some((pose) => pose.poseId === poseId))
          .map((model) => model.name)
        if (referencing.length > 0) {
          throw new Error(`Pose is attached to VRM model(s): ${referencing.join(', ')}`)
        }
        await poseRegistry.delete(poseId, userId)
        return { content: [{ type: 'text', text: JSON.stringify({ deleted: poseId }) }] }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )
}

function getReadablePose(
  poseRegistry: PoseRegistryStore,
  vrmRegistry: VrmRegistryStore,
  poseId: string,
  userId: string,
  usePublicVrms: boolean
): PoseResource | undefined {
  const pose = poseRegistry.get(poseId)
  if (!pose) return undefined
  if (pose.ownerUserId === userId) return pose
  if (!usePublicVrms) return undefined
  const referencedByPublicVrm = vrmRegistry
    .listVisible({ userId, usePublicVrms })
    .some((model) => model.isPublic && model.poses?.some((attachment) => attachment.poseId === poseId))
  return referencedByPublicVrm ? pose : undefined
}
