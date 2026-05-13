import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ServerConfig } from '../../config.js'
import { ANONYMOUS_USER_ID } from '../auth-context.js'

const SETTINGS_FILE_NAME = 'player-settings.json'

export interface PlayerSettingsOverrides {
  speedScale?: number
  prePhonemeLength?: number
  postPhonemeLength?: number
  autoPlay?: boolean
  usePublicVrms?: boolean
  activeModelId?: string
}

export interface PlayerSettingsPatch {
  speedScale?: number | null
  prePhonemeLength?: number | null
  postPhonemeLength?: number | null
  autoPlay?: boolean | null
  usePublicVrms?: boolean | null
  activeModelId?: string | null
}

export interface PlayerCliDefaults {
  speedScale: number
  prePhonemeLength?: number
  postPhonemeLength?: number
  autoPlay: boolean
  usePublicVrms: boolean
}

export class PlayerSettingsStore {
  private overridesByUser = new Map<string, PlayerSettingsOverrides>()
  private readonly settingsFilePath: string
  private readonly cliDefaults: PlayerCliDefaults
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(config: ServerConfig, settingsFilePath?: string) {
    this.settingsFilePath = settingsFilePath || join(config.playerCacheDir, SETTINGS_FILE_NAME)
    this.cliDefaults = {
      speedScale: config.defaultSpeedScale,
      prePhonemeLength: config.defaultPrePhonemeLength,
      postPhonemeLength: config.defaultPostPhonemeLength,
      autoPlay: config.autoPlay,
      usePublicVrms: true,
    }

    try {
      mkdirSync(dirname(this.settingsFilePath), { recursive: true })
    } catch (error) {
      console.warn('Warning: failed to prepare player settings directory:', error)
    }

    this.loadFromDisk()
  }

  get(userId = ANONYMOUS_USER_ID): PlayerSettingsOverrides {
    return { ...(this.overridesByUser.get(userId) ?? {}) }
  }

  getCliDefaults(): PlayerCliDefaults {
    return { ...this.cliDefaults }
  }

  set(patch: PlayerSettingsPatch, userId = ANONYMOUS_USER_ID): PlayerSettingsOverrides {
    this.overridesByUser.set(userId, applyPatch(this.overridesByUser.get(userId) ?? {}, patch))
    this.scheduleSave()
    return this.get(userId)
  }

  reset(userId = ANONYMOUS_USER_ID): PlayerSettingsOverrides {
    this.overridesByUser.delete(userId)
    this.scheduleSave()
    return this.get(userId)
  }

  applyDefaults<T extends PlayerSettingsOverrides>(
    input: T,
    userId = ANONYMOUS_USER_ID
  ): T & Required<Pick<PlayerSettingsOverrides, 'speedScale' | 'autoPlay' | 'usePublicVrms'>> {
    const overrides = this.overridesByUser.get(userId) ?? {}
    return {
      ...input,
      speedScale: input.speedScale ?? overrides.speedScale ?? this.cliDefaults.speedScale,
      prePhonemeLength: input.prePhonemeLength ?? overrides.prePhonemeLength ?? this.cliDefaults.prePhonemeLength,
      postPhonemeLength: input.postPhonemeLength ?? overrides.postPhonemeLength ?? this.cliDefaults.postPhonemeLength,
      autoPlay: input.autoPlay ?? overrides.autoPlay ?? this.cliDefaults.autoPlay,
      usePublicVrms: input.usePublicVrms ?? overrides.usePublicVrms ?? this.cliDefaults.usePublicVrms,
    }
  }

  private scheduleSave(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.saveToDisk().catch((e) => console.warn('Warning: failed to persist player settings:', e))
    }, 300)
  }

  private async saveToDisk(): Promise<void> {
    try {
      const payload = JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        users: Object.fromEntries(this.overridesByUser),
      })
      const tempPath = `${this.settingsFilePath}.tmp`
      await writeFile(tempPath, payload, 'utf-8')
      await rename(tempPath, this.settingsFilePath)
    } catch (error) {
      console.warn('Warning: failed to persist player settings:', error)
    }
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.settingsFilePath)) return
      const raw = readFileSync(this.settingsFilePath, 'utf-8')
      const parsed = JSON.parse(raw) as {
        overrides?: PlayerSettingsOverrides
        users?: Record<string, PlayerSettingsOverrides>
      }
      this.overridesByUser.clear()
      if (parsed.users && typeof parsed.users === 'object') {
        for (const [userId, overrides] of Object.entries(parsed.users)) {
          this.overridesByUser.set(userId, normalizeOverrides(overrides ?? {}))
        }
      } else if (parsed.overrides) {
        this.overridesByUser.set(ANONYMOUS_USER_ID, normalizeOverrides(parsed.overrides))
      }
    } catch (error) {
      console.warn('Warning: failed to load player settings, starting empty:', error)
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

function applyPatch(current: PlayerSettingsOverrides, patch: PlayerSettingsPatch): PlayerSettingsOverrides {
  const next: PlayerSettingsOverrides = { ...current }
  for (const key of ['speedScale', 'prePhonemeLength', 'postPhonemeLength'] as const) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value === null || value === undefined) {
      delete next[key]
    } else if (Number.isFinite(value)) {
      next[key] = value
    }
  }
  if ('autoPlay' in patch) {
    const value = patch.autoPlay
    if (value === null || value === undefined) {
      next.autoPlay = undefined
    } else {
      next.autoPlay = value
    }
  }
  if ('usePublicVrms' in patch) {
    const value = patch.usePublicVrms
    if (value === null || value === undefined) {
      next.usePublicVrms = undefined
    } else {
      next.usePublicVrms = value
    }
  }
  if ('activeModelId' in patch) {
    const value = patch.activeModelId
    if (value === null || value === undefined || !value.trim()) {
      next.activeModelId = undefined
    } else {
      next.activeModelId = value
    }
  }
  return next
}

function normalizeOverrides(input: PlayerSettingsOverrides): PlayerSettingsOverrides {
  const result: PlayerSettingsOverrides = {}
  for (const key of ['speedScale', 'prePhonemeLength', 'postPhonemeLength'] as const) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value
  }
  if (typeof input.autoPlay === 'boolean') result.autoPlay = input.autoPlay
  if (typeof input.usePublicVrms === 'boolean') result.usePublicVrms = input.usePublicVrms
  if (typeof input.activeModelId === 'string' && input.activeModelId.trim()) result.activeModelId = input.activeModelId
  return result
}
