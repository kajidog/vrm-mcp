import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createDefaultBuiltinAttachments } from '../pose-registry/types.js'
import { extractVrmThumbnail } from './thumbnail.js'
import type { VrmModel } from './types.js'

const REGISTRY_FILE_NAME = 'vrm-registry.json'
const VRM_DIR_NAME = 'vrms'
export const MAX_VRM_BYTES = 100 * 1024 * 1024

export interface VrmRegistryStoreOptions {
  cacheDir: string
  registryFilePath?: string
}

export interface RegisterVrmInput {
  name: string
  speakerId: number
  isDefault?: boolean
  isPublic?: boolean
  poses?: VrmModel['poses']
  vrmBase64: string
}

export interface UpdateVrmInput {
  name?: string
  speakerId?: number
  isDefault?: boolean
  isPublic?: boolean
  poses?: VrmModel['poses']
}

/**
 * VRM 登録ストア。メタデータは JSON で永続化、VRM バイナリは個別ファイル保存。
 *
 * 永続化は SessionStateStore と同じく mkdir → atomic rename → デバウンス保存。
 * isDefault は同時に true となるエントリが 1 件以下になるよう排他制御する。
 */
export class VrmRegistryStore {
  private readonly registry = new Map<string, VrmModel>()
  private readonly registryFilePath: string
  private readonly vrmDir: string
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: VrmRegistryStoreOptions) {
    this.registryFilePath = options.registryFilePath || join(options.cacheDir, REGISTRY_FILE_NAME)
    this.vrmDir = join(options.cacheDir, VRM_DIR_NAME)

    try {
      mkdirSync(dirname(this.registryFilePath), { recursive: true })
      mkdirSync(this.vrmDir, { recursive: true })
    } catch (error) {
      console.warn('Warning: failed to prepare VRM registry directory:', error)
    }

    this.loadFromDisk()
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  list(): VrmModel[] {
    return [...this.registry.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): VrmModel | undefined {
    return this.registry.get(id)
  }

  getDefault(): VrmModel | undefined {
    for (const model of this.registry.values()) {
      if (model.isDefault) return model
    }
    return undefined
  }

  async register(input: RegisterVrmInput): Promise<VrmModel> {
    const id = randomUUID()
    const vrmFilePath = join(this.vrmDir, `${id}.vrm`)
    const buffer = decodeAndValidateVrmBase64(input.vrmBase64)

    await this.writeBinaryAtomic(vrmFilePath, buffer)
    const thumbnail = extractVrmThumbnail(buffer)

    const now = Date.now()
    const model: VrmModel = {
      id,
      name: input.name,
      speakerId: input.speakerId,
      isDefault: input.isDefault === true,
      isPublic: input.isPublic === true,
      poses: input.poses ?? createDefaultBuiltinAttachments(),
      vrmFilePath,
      vrmSizeBytes: buffer.byteLength,
      ...(thumbnail
        ? { thumbnailBase64: thumbnail.thumbnailBase64, thumbnailMimeType: thumbnail.thumbnailMimeType }
        : {}),
      createdAt: now,
      updatedAt: now,
    }

    if (model.isDefault) {
      this.clearDefaultExcept(id)
    }
    this.registry.set(id, model)
    this.scheduleSave()
    return model
  }

  update(id: string, fields: UpdateVrmInput): VrmModel {
    const existing = this.registry.get(id)
    if (!existing) throw new Error(`VRM not found: ${id}`)

    const next: VrmModel = {
      ...existing,
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.speakerId !== undefined ? { speakerId: fields.speakerId } : {}),
      ...(fields.isDefault !== undefined ? { isDefault: fields.isDefault } : {}),
      ...(fields.isPublic !== undefined ? { isPublic: fields.isPublic } : {}),
      ...(fields.poses !== undefined ? { poses: fields.poses } : {}),
      updatedAt: Date.now(),
    }

    if (fields.isDefault === true) {
      this.clearDefaultExcept(id)
    }
    this.registry.set(id, next)
    this.scheduleSave()
    return next
  }

  async replaceBinary(id: string, vrmBase64: string): Promise<VrmModel> {
    const existing = this.registry.get(id)
    if (!existing) throw new Error(`VRM not found: ${id}`)

    const buffer = decodeAndValidateVrmBase64(vrmBase64)
    await this.writeBinaryAtomic(existing.vrmFilePath, buffer)
    const thumbnail = extractVrmThumbnail(buffer)

    const next: VrmModel = {
      ...existing,
      vrmSizeBytes: buffer.byteLength,
      thumbnailBase64: thumbnail?.thumbnailBase64,
      thumbnailMimeType: thumbnail?.thumbnailMimeType,
      updatedAt: Date.now(),
    }
    this.registry.set(id, next)
    this.scheduleSave()
    return next
  }

  async delete(id: string): Promise<void> {
    const existing = this.registry.get(id)
    if (!existing) return

    this.registry.delete(id)
    this.scheduleSave()

    try {
      if (existsSync(existing.vrmFilePath)) {
        await unlink(existing.vrmFilePath)
      }
    } catch (error) {
      console.warn(`Warning: failed to delete VRM file ${existing.vrmFilePath}:`, error)
    }
  }

  setDefault(id: string): VrmModel {
    return this.update(id, { isDefault: true })
  }

  readVrmBase64(id: string): string {
    const model = this.registry.get(id)
    if (!model) throw new Error(`VRM not found: ${id}`)
    if (!existsSync(model.vrmFilePath)) {
      throw new Error(`VRM file missing on disk: ${model.vrmFilePath}`)
    }
    return readFileSync(model.vrmFilePath).toString('base64')
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private clearDefaultExcept(keepId: string): void {
    for (const [id, model] of this.registry) {
      if (id !== keepId && model.isDefault) {
        this.registry.set(id, { ...model, isDefault: false, updatedAt: Date.now() })
      }
    }
  }

  private async writeBinaryAtomic(filePath: string, buffer: Buffer): Promise<void> {
    const tempPath = `${filePath}.tmp`
    await writeFile(tempPath, buffer)
    await rename(tempPath, filePath)
  }

  private scheduleSave(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.saveToDisk().catch((e) => console.warn('Warning: failed to persist VRM registry:', e))
    }, 300)
  }

  private async saveToDisk(): Promise<void> {
    try {
      const payload = JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        entries: [...this.registry.values()],
      })
      const tempPath = `${this.registryFilePath}.tmp`
      await writeFile(tempPath, payload, 'utf-8')
      await rename(tempPath, this.registryFilePath)
    } catch (error) {
      console.warn('Warning: failed to persist VRM registry:', error)
    }
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.registryFilePath)) return
      const raw = readFileSync(this.registryFilePath, 'utf-8')
      const parsed = JSON.parse(raw) as { entries?: VrmModel[] }
      if (!Array.isArray(parsed.entries)) return

      for (const entry of parsed.entries) {
        if (!entry || typeof entry.id !== 'string') continue
        if (!existsSync(entry.vrmFilePath)) {
          // バイナリが消えているエントリは無視（DB だけ残った状態を救う）
          continue
        }
        this.registry.set(entry.id, entry)
      }
    } catch (error) {
      console.warn('Warning: failed to load VRM registry, starting empty:', error)
    }
  }

  // テスト用: デバウンス完了を待つ
  async flush(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    await this.saveToDisk()
  }
}

function decodeAndValidateVrmBase64(value: string): Buffer {
  const raw = value.trim()
  const withoutDataUrl = raw.startsWith('data:') ? (raw.split(',', 2)[1] ?? '') : raw
  const normalized = withoutDataUrl.replace(/\s/g, '')
  if (!normalized) {
    throw new Error('vrmBase64 is required')
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || /=/.test(normalized.slice(0, -2))) {
    throw new Error('vrmBase64 must be valid base64')
  }

  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const buffer = Buffer.from(padded, 'base64')
  if (buffer.byteLength === 0) {
    throw new Error('VRM file is empty')
  }
  if (buffer.byteLength > MAX_VRM_BYTES) {
    throw new Error(`VRM file is too large. Maximum size is ${MAX_VRM_BYTES} bytes.`)
  }
  if (buffer.byteLength < 12 || buffer.subarray(0, 4).toString('ascii') !== 'glTF') {
    throw new Error('VRM file must be a GLB/VRM binary starting with glTF magic')
  }
  return buffer
}
