import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ServerConfig } from '../../config.js'

const SETTINGS_FILE_NAME = 'player-settings.json'

export interface PlayerSettingsOverrides {
  speedScale?: number
  prePhonemeLength?: number
  postPhonemeLength?: number
}

export interface PlayerSettingsPatch {
  speedScale?: number | null
  prePhonemeLength?: number | null
  postPhonemeLength?: number | null
}

export interface PlayerCliDefaults {
  speedScale: number
  prePhonemeLength?: number
  postPhonemeLength?: number
}

export class PlayerSettingsStore {
  private overrides: PlayerSettingsOverrides = {}
  private readonly settingsFilePath: string
  private readonly cliDefaults: PlayerCliDefaults
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(config: ServerConfig, settingsFilePath?: string) {
    this.settingsFilePath = settingsFilePath || join(config.playerCacheDir, SETTINGS_FILE_NAME)
    this.cliDefaults = {
      speedScale: config.defaultSpeedScale,
      prePhonemeLength: config.defaultPrePhonemeLength,
      postPhonemeLength: config.defaultPostPhonemeLength,
    }

    try {
      mkdirSync(dirname(this.settingsFilePath), { recursive: true })
    } catch (error) {
      console.warn('Warning: failed to prepare player settings directory:', error)
    }

    this.loadFromDisk()
  }

  get(): PlayerSettingsOverrides {
    return { ...this.overrides }
  }

  getCliDefaults(): PlayerCliDefaults {
    return { ...this.cliDefaults }
  }

  set(patch: PlayerSettingsPatch): PlayerSettingsOverrides {
    this.overrides = applyPatch(this.overrides, patch)
    this.scheduleSave()
    return this.get()
  }

  reset(): PlayerSettingsOverrides {
    this.overrides = {}
    this.scheduleSave()
    return this.get()
  }

  applyDefaults<T extends PlayerSettingsOverrides>(
    input: T
  ): T & Required<Pick<PlayerSettingsOverrides, 'speedScale'>> {
    return {
      ...input,
      speedScale: input.speedScale ?? this.overrides.speedScale ?? this.cliDefaults.speedScale,
      prePhonemeLength: input.prePhonemeLength ?? this.overrides.prePhonemeLength ?? this.cliDefaults.prePhonemeLength,
      postPhonemeLength:
        input.postPhonemeLength ?? this.overrides.postPhonemeLength ?? this.cliDefaults.postPhonemeLength,
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
        overrides: this.overrides,
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
      const parsed = JSON.parse(raw) as { overrides?: PlayerSettingsOverrides }
      this.overrides = normalizeOverrides(parsed.overrides ?? {})
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
  return next
}

function normalizeOverrides(input: PlayerSettingsOverrides): PlayerSettingsOverrides {
  const result: PlayerSettingsOverrides = {}
  for (const key of ['speedScale', 'prePhonemeLength', 'postPhonemeLength'] as const) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value
  }
  return result
}
