export interface PoseResource {
  id: string
  ownerUserId: string
  name?: string
  vrmaFilePath: string
  vrmaSizeBytes: number
  loop: boolean
  createdAt: number
  updatedAt: number
}

export interface ModelPoseAttachment {
  poseId: string
  name: string
}

export const BUILTIN_POSE_IDS = ['idle', 'neutral', 'wave', 'bow', 'point', 'think', 'cheer'] as const
export type BuiltinPoseId = (typeof BUILTIN_POSE_IDS)[number]

export function toBuiltinPoseResourceId(id: BuiltinPoseId): string {
  return `builtin:${id}`
}

export function isBuiltinPoseResourceId(value: string): boolean {
  return BUILTIN_POSE_IDS.some((id) => value === toBuiltinPoseResourceId(id))
}

export function createDefaultBuiltinAttachments(): ModelPoseAttachment[] {
  return BUILTIN_POSE_IDS.map((id) => ({ poseId: toBuiltinPoseResourceId(id), name: id }))
}
