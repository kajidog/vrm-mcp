import type { App } from '@modelcontextprotocol/ext-apps'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { POSE_PRESETS, posePresetIdFromResourceId } from '../presets'
import type { PoseMetadata, PoseSource } from '../types'

interface TextContent {
  type: 'text'
  text: string
}

function getTextPayload(content: unknown): string | null {
  if (!Array.isArray(content)) return null
  const text = content.find((c) => (c as { type?: string }).type === 'text') as TextContent | undefined
  return text?.type === 'text' ? text.text : null
}

function parseToolJson<T>(result: CallToolResult): T {
  if (result.isError) throw new Error(getTextPayload(result.content) ?? 'Tool call failed')
  const text = getTextPayload(result.content)
  if (!text) throw new Error('Tool returned no text content')
  return JSON.parse(text) as T
}

export interface RegisterPoseRequest {
  id: string
  name?: string
  vrmaBase64: string
  loop: boolean
}

export function createPoseLibrary(poses: PoseMetadata[]): Map<string, PoseSource> {
  const map = new Map<string, PoseSource>()
  for (const [presetId, preset] of Object.entries(POSE_PRESETS)) {
    map.set(`builtin:${presetId}`, {
      kind: 'builtin',
      id: `builtin:${presetId}`,
      presetId: presetId as keyof typeof POSE_PRESETS,
      applyToVrm: preset.applyToVrm,
    })
  }
  for (const pose of poses) {
    const presetId = posePresetIdFromResourceId(pose.id)
    if (presetId) continue
    if (!pose.vrmaUrl) continue
    map.set(pose.id, {
      kind: 'vrma',
      id: pose.id,
      resourceId: pose.id,
      vrmaUrl: pose.vrmaUrl,
      loop: pose.loop,
    })
  }
  return map
}

export function usePoseRegistry(app: App | null) {
  const [poses, setPoses] = useState<PoseMetadata[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const appRef = useRef(app)
  appRef.current = app

  const refresh = useCallback(async () => {
    const currentApp = appRef.current
    if (!currentApp) return
    setLoading(true)
    setError(null)
    try {
      const result = await currentApp.callServerTool({ name: '_list_poses_for_player', arguments: {} })
      const parsed = parseToolJson<{ poses: PoseMetadata[] }>(result)
      setPoses(parsed.poses ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const register = useCallback(
    async (input: RegisterPoseRequest): Promise<PoseMetadata> => {
      const currentApp = appRef.current
      if (!currentApp) throw new Error('App is not ready')
      const result = await currentApp.callServerTool({ name: '_register_pose_for_player', arguments: { ...input } })
      const parsed = parseToolJson<{ pose: PoseMetadata }>(result)
      await refresh()
      return parsed.pose
    },
    [refresh]
  )

  const update = useCallback(
    async (poseId: string, fields: { name?: string; loop?: boolean }): Promise<PoseMetadata> => {
      const currentApp = appRef.current
      if (!currentApp) throw new Error('App is not ready')
      const result = await currentApp.callServerTool({
        name: '_update_pose_for_player',
        arguments: { poseId, ...fields },
      })
      const parsed = parseToolJson<{ pose: PoseMetadata }>(result)
      await refresh()
      return parsed.pose
    },
    [refresh]
  )

  const remove = useCallback(
    async (poseId: string): Promise<void> => {
      const currentApp = appRef.current
      if (!currentApp) throw new Error('App is not ready')
      const result = await currentApp.callServerTool({ name: '_delete_pose_for_player', arguments: { poseId } })
      parseToolJson<{ deleted: string }>(result)
      await refresh()
    },
    [refresh]
  )

  useEffect(() => {
    if (app) void refresh()
  }, [app, refresh])

  const poseLibrary = useMemo(() => createPoseLibrary(poses), [poses])
  return { poses, poseLibrary, loading, error, refresh, register, update, remove }
}
