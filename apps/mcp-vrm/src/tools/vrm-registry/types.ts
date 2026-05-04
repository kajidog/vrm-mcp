export interface VrmModel {
  id: string
  name: string
  speakerId: number
  isDefault: boolean
  isPublic: boolean
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
