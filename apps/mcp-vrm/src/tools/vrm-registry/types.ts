import type { EmotionBinding } from '../emotions.js'
import type { ModelPoseAttachment } from '../pose-registry/types.js'

export interface VrmModel {
  id: string
  ownerUserId: string
  name: string
  speakerId: number
  isDefault: boolean
  isPublic: boolean
  poses?: ModelPoseAttachment[]
  emotionBindings?: EmotionBinding[]
  vrmFilePath: string
  vrmSizeBytes: number
  thumbnailBase64?: string
  thumbnailMimeType?: string
  createdAt: number
  updatedAt: number
}

export type VrmModelMetadata = Omit<VrmModel, 'vrmFilePath'> & {
  vrmFilePath?: string
}
