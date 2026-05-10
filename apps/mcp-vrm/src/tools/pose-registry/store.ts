import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ANONYMOUS_USER_ID } from '../auth-context.js'
import type { PoseResource } from './types.js'

const REGISTRY_FILE_NAME = 'pose-registry.json'
const POSE_DIR_NAME = 'poses'
const POSE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const MAX_VRMA_BYTES = 10 * 1024 * 1024

export interface PoseRegistryStoreOptions {
  cacheDir: string
  registryFilePath?: string
}

export interface RegisterPoseInput {
  ownerUserId?: string
  id: string
  name?: string
  vrmaBase64: string
  loop: boolean
}

export interface PoseVisibilityOptions {
  userId: string
}

export interface UpdatePoseInput {
  name?: string
  loop?: boolean
}

export class PoseRegistryStore {
  private readonly registry = new Map<string, PoseResource>()
  private readonly registryFilePath: string
  private readonly poseDir: string
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: PoseRegistryStoreOptions) {
    this.registryFilePath = options.registryFilePath || join(options.cacheDir, REGISTRY_FILE_NAME)
    this.poseDir = join(options.cacheDir, POSE_DIR_NAME)

    try {
      mkdirSync(dirname(this.registryFilePath), { recursive: true })
      mkdirSync(this.poseDir, { recursive: true })
    } catch (error) {
      console.warn('Warning: failed to prepare pose registry directory:', error)
    }

    this.loadFromDisk()
  }

  list(): PoseResource[] {
    return [...this.registry.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  listOwned(userId: string): PoseResource[] {
    return this.list().filter((pose) => pose.ownerUserId === userId)
  }

  get(id: string): PoseResource | undefined {
    return this.registry.get(id)
  }

  getOwned(id: string, userId: string): PoseResource | undefined {
    const pose = this.registry.get(id)
    return pose?.ownerUserId === userId ? pose : undefined
  }

  async register(input: RegisterPoseInput): Promise<PoseResource> {
    const id = validatePoseId(input.id)
    if (this.registry.has(id)) throw new Error(`Pose already exists: ${id}`)
    const buffer = decodeAndValidateVrmaBase64(input.vrmaBase64)
    const vrmaFilePath = join(this.poseDir, `${id}.vrma`)
    await this.writeBinaryAtomic(vrmaFilePath, buffer)

    const now = Date.now()
    const pose: PoseResource = {
      id,
      ownerUserId: normalizeOwnerUserId(input.ownerUserId),
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      vrmaFilePath,
      vrmaSizeBytes: buffer.byteLength,
      loop: input.loop,
      createdAt: now,
      updatedAt: now,
    }
    this.registry.set(id, pose)
    this.scheduleSave()
    return pose
  }

  update(id: string, fields: UpdatePoseInput, ownerUserId?: string): PoseResource {
    const existing = this.registry.get(id)
    if (!existing) throw new Error(`Pose not found: ${id}`)
    assertOwner(existing, ownerUserId)
    const next: PoseResource = {
      ...existing,
      ...(fields.name !== undefined ? { name: fields.name.trim() || undefined } : {}),
      ...(fields.loop !== undefined ? { loop: fields.loop } : {}),
      updatedAt: Date.now(),
    }
    this.registry.set(id, next)
    this.scheduleSave()
    return next
  }

  async delete(id: string, ownerUserId?: string): Promise<void> {
    const existing = this.registry.get(id)
    if (!existing) return
    assertOwner(existing, ownerUserId)
    this.registry.delete(id)
    this.scheduleSave()
    try {
      if (existsSync(existing.vrmaFilePath)) await unlink(existing.vrmaFilePath)
    } catch (error) {
      console.warn(`Warning: failed to delete VRMA file ${existing.vrmaFilePath}:`, error)
    }
  }

  readVrmaBase64(id: string): string {
    const pose = this.registry.get(id)
    if (!pose) throw new Error(`Pose not found: ${id}`)
    if (!existsSync(pose.vrmaFilePath)) throw new Error(`VRMA file missing on disk: ${pose.vrmaFilePath}`)
    return readFileSync(pose.vrmaFilePath).toString('base64')
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
      this.saveToDisk().catch((e) => console.warn('Warning: failed to persist pose registry:', e))
    }, 300)
  }

  private async saveToDisk(): Promise<void> {
    try {
      const payload = JSON.stringify({ version: 1, savedAt: Date.now(), entries: [...this.registry.values()] })
      const tempPath = `${this.registryFilePath}.tmp`
      await writeFile(tempPath, payload, 'utf-8')
      await rename(tempPath, this.registryFilePath)
    } catch (error) {
      console.warn('Warning: failed to persist pose registry:', error)
    }
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.registryFilePath)) return
      const parsed = JSON.parse(readFileSync(this.registryFilePath, 'utf-8')) as { entries?: PoseResource[] }
      if (!Array.isArray(parsed.entries)) return
      for (const entry of parsed.entries) {
        if (!entry || typeof entry.id !== 'string') continue
        if (!existsSync(entry.vrmaFilePath)) continue
        this.registry.set(entry.id, { ...entry, ownerUserId: normalizeOwnerUserId(entry.ownerUserId) })
      }
    } catch (error) {
      console.warn('Warning: failed to load pose registry, starting empty:', error)
    }
  }

  async flush(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    await this.saveToDisk()
  }
}

function normalizeOwnerUserId(ownerUserId: string | undefined): string {
  return ownerUserId?.trim() || ANONYMOUS_USER_ID
}

function assertOwner(pose: PoseResource, ownerUserId: string | undefined): void {
  if (ownerUserId === undefined) return
  if (pose.ownerUserId !== ownerUserId) throw new Error(`Pose not found: ${pose.id}`)
}

export function validatePoseId(value: string): string {
  const id = value.trim()
  if (!POSE_ID_PATTERN.test(id)) throw new Error('Pose ID must match /^[A-Za-z0-9_-]{1,64}$/')
  if (id.startsWith('builtin:')) throw new Error('Pose ID starting with builtin: is reserved')
  return id
}

function decodeAndValidateVrmaBase64(value: string): Buffer {
  const raw = value.trim()
  const withoutDataUrl = raw.startsWith('data:') ? (raw.split(',', 2)[1] ?? '') : raw
  const normalized = withoutDataUrl.replace(/\s/g, '')
  if (!normalized) throw new Error('vrmaBase64 is required')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || /=/.test(normalized.slice(0, -2))) {
    throw new Error('vrmaBase64 must be valid base64')
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const buffer = Buffer.from(padded, 'base64')
  if (buffer.byteLength === 0) throw new Error('VRMA file is empty')
  if (buffer.byteLength > MAX_VRMA_BYTES) {
    throw new Error(`VRMA file is too large. Maximum size is ${MAX_VRMA_BYTES} bytes.`)
  }
  if (buffer.byteLength < 12 || buffer.subarray(0, 4).toString('ascii') !== 'glTF') {
    throw new Error('VRMA file must be a GLB/VRMA binary starting with glTF magic')
  }
  return buffer
}
