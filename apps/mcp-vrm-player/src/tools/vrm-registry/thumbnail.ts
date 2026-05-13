type GltfImage = {
  uri?: string
  mimeType?: string
  bufferView?: number
}

type GltfBufferView = {
  buffer?: number
  byteOffset?: number
  byteLength?: number
}

type GltfTexture = {
  source?: number
}

type VrmGltf = {
  extensions?: {
    VRMC_vrm?: {
      meta?: {
        thumbnailImage?: number
      }
    }
    VRM?: {
      meta?: {
        texture?: number
      }
    }
  }
  images?: GltfImage[]
  textures?: GltfTexture[]
  bufferViews?: GltfBufferView[]
}

export interface ExtractedVrmThumbnail {
  thumbnailBase64: string
  thumbnailMimeType: string
}

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK_TYPE = 0x4e4f534a
const BIN_CHUNK_TYPE = 0x004e4942

export function extractVrmThumbnail(buffer: Buffer): ExtractedVrmThumbnail | undefined {
  try {
    const parsed = parseGlb(buffer)
    if (!parsed) return undefined

    const imageIndex = getThumbnailImageIndex(parsed.gltf)
    if (imageIndex === undefined) return undefined

    const image = parsed.gltf.images?.[imageIndex]
    if (!image) return undefined

    if (image.uri?.startsWith('data:')) {
      return parseDataUriImage(image.uri)
    }

    if (image.bufferView !== undefined && parsed.bin) {
      const view = parsed.gltf.bufferViews?.[image.bufferView]
      if (!view || (view.buffer !== undefined && view.buffer !== 0)) return undefined
      const start = view.byteOffset ?? 0
      const end = start + (view.byteLength ?? 0)
      if (end <= start || end > parsed.bin.byteLength) return undefined
      return {
        thumbnailBase64: parsed.bin.subarray(start, end).toString('base64'),
        thumbnailMimeType: image.mimeType ?? 'image/png',
      }
    }

    return undefined
  } catch {
    return undefined
  }
}

function parseGlb(buffer: Buffer): { gltf: VrmGltf; bin?: Buffer } | undefined {
  if (buffer.byteLength < 20) return undefined
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) return undefined

  const declaredLength = buffer.readUInt32LE(8)
  const totalLength = Math.min(declaredLength, buffer.byteLength)
  let offset = 12
  let json: VrmGltf | undefined
  let bin: Buffer | undefined

  while (offset + 8 <= totalLength) {
    const chunkLength = buffer.readUInt32LE(offset)
    const chunkType = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + chunkLength
    if (end > totalLength) break

    if (chunkType === JSON_CHUNK_TYPE) {
      json = JSON.parse(buffer.subarray(start, end).toString('utf-8')) as VrmGltf
    } else if (chunkType === BIN_CHUNK_TYPE) {
      bin = buffer.subarray(start, end)
    }
    offset = end
  }

  return json ? { gltf: json, bin } : undefined
}

function getThumbnailImageIndex(gltf: VrmGltf): number | undefined {
  const vrm1Image = gltf.extensions?.VRMC_vrm?.meta?.thumbnailImage
  if (typeof vrm1Image === 'number') return vrm1Image

  const vrm0Texture = gltf.extensions?.VRM?.meta?.texture
  if (typeof vrm0Texture !== 'number') return undefined
  const source = gltf.textures?.[vrm0Texture]?.source
  return typeof source === 'number' ? source : undefined
}

function parseDataUriImage(uri: string): ExtractedVrmThumbnail | undefined {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(uri)
  if (!match) return undefined
  const mimeType = match[1] || 'image/png'
  const isBase64 = Boolean(match[2])
  const payload = match[3] ?? ''
  return {
    thumbnailBase64: isBase64 ? payload : Buffer.from(decodeURIComponent(payload), 'binary').toString('base64'),
    thumbnailMimeType: mimeType,
  }
}
