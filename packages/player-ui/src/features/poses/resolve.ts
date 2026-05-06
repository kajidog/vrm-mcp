import { DEFAULT_POSE_ID, POSE_PRESETS, posePresetIdFromResourceId } from './presets'
import type { ModelPoseAttachment, PoseSource } from './types'

export function resolveSegmentPose(
  segmentPose: string | undefined,
  modelPoses: ModelPoseAttachment[] | undefined,
  poseLibrary: Map<string, PoseSource>
): PoseSource | null {
  const requested = segmentPose?.trim() || DEFAULT_POSE_ID
  const matches = (modelPoses ?? []).filter((pose) => pose.name === requested)

  if (matches.length > 0) {
    const picked = matches[Math.floor(Math.random() * matches.length)]
    return poseLibrary.get(picked.poseId) ?? null
  }

  if (requested in POSE_PRESETS) {
    const presetId = requested as keyof typeof POSE_PRESETS
    return poseLibrary.get(`builtin:${presetId}`) ?? null
  }

  const presetId = posePresetIdFromResourceId(requested)
  if (presetId) return poseLibrary.get(`builtin:${presetId}`) ?? null

  return null
}
