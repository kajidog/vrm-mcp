import type { VRM } from '@pixiv/three-vrm'
import type { PosePresetId } from './presets'

export interface ModelPoseAttachment {
  poseId: string
  name: string
}

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

export type PoseSource =
  | {
      kind: 'builtin'
      id: string
      presetId: PosePresetId
      applyToVrm: (vrm: VRM, t: number) => void
    }
  | {
      kind: 'vrma'
      id: string
      resourceId: string
      vrmaUrl: string
      vrmaData?: ArrayBuffer
      loop: boolean
    }
