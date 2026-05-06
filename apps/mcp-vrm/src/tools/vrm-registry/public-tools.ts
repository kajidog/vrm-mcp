import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { getVrmModelUrl } from '../../vrm-http.js'
import type { PoseRegistryStore } from '../pose-registry/store.js'
import { isBuiltinPoseResourceId } from '../pose-registry/types.js'
import { registerToolIfEnabled } from '../registration.js'
import type { ToolDeps } from '../types.js'
import { createErrorResponse } from '../utils.js'
import type { VrmRegistryStore } from './store.js'

interface PublicVrmEntry {
  id: string
  name: string
  speakerId: number
  isDefault: boolean
  vrmUrl: string
  vrmSizeBytes: number
  updatedAt: number
  poses: { id: string; name: string; loop: boolean }[]
}

export function registerVrmPublicTools(
  deps: ToolDeps,
  registry: VrmRegistryStore,
  poseRegistry: PoseRegistryStore
): void {
  const { server, disabledTools, config } = deps

  registerToolIfEnabled(
    server,
    disabledTools,
    'list_vrms',
    {
      title: 'List VRMs',
      description:
        'List registered VRM models. Use this before calling speak_player to discover valid modelId values and model poses. Pass segments[].pose as one of poses[].name; duplicate names are randomly selected during playback. Returns metadata only (no binary).',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (): Promise<CallToolResult> => {
      try {
        const entries: PublicVrmEntry[] = registry.list().map((model) => ({
          id: model.id,
          name: model.name,
          speakerId: model.speakerId,
          isDefault: model.isDefault,
          vrmUrl: getVrmModelUrl(config, model.id),
          vrmSizeBytes: model.vrmSizeBytes,
          updatedAt: model.updatedAt,
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
