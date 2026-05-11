import { useEffect, useState } from 'react'

const STORAGE_KEY = 'vrm-player:render-settings'
const EVENT_NAME = 'vrm-player:render-settings-changed'

export interface RenderSettings {
  // Canvas の dpr 上限。1 で標準、上げるほど高解像度（負荷増）。
  dprMax: number
  // 自動瞬きの有無。
  blinkEnabled: boolean
  poseEasing: 'linear' | 'easeInOutQuad'
  expressionTransitionMs: number
  moraTimingOffsetMs: number
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  dprMax: 1.5,
  blinkEnabled: true,
  poseEasing: 'easeInOutQuad',
  expressionTransitionMs: 120,
  moraTimingOffsetMs: 0,
}

export const DPR_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1.0, label: '標準 (1.0×)' },
  { value: 1.5, label: '高 (1.5×)' },
  { value: 2.0, label: '最高 (2.0×)' },
  { value: 3.0, label: 'ネイティブ (3.0×)' },
]

export const POSE_EASING_OPTIONS: Array<{ value: RenderSettings['poseEasing']; label: string }> = [
  { value: 'easeInOutQuad', label: 'なめらか' },
  { value: 'linear', label: '一定' },
]

function load(): RenderSettings {
  if (typeof window === 'undefined') return DEFAULT_RENDER_SETTINGS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_RENDER_SETTINGS
    const parsed = JSON.parse(raw) as Partial<RenderSettings>
    return {
      dprMax: typeof parsed.dprMax === 'number' && parsed.dprMax > 0 ? parsed.dprMax : DEFAULT_RENDER_SETTINGS.dprMax,
      blinkEnabled:
        typeof parsed.blinkEnabled === 'boolean' ? parsed.blinkEnabled : DEFAULT_RENDER_SETTINGS.blinkEnabled,
      poseEasing:
        parsed.poseEasing === 'linear' || parsed.poseEasing === 'easeInOutQuad'
          ? parsed.poseEasing
          : DEFAULT_RENDER_SETTINGS.poseEasing,
      expressionTransitionMs:
        typeof parsed.expressionTransitionMs === 'number' && Number.isFinite(parsed.expressionTransitionMs)
          ? Math.min(1000, Math.max(0, parsed.expressionTransitionMs))
          : DEFAULT_RENDER_SETTINGS.expressionTransitionMs,
      moraTimingOffsetMs:
        typeof parsed.moraTimingOffsetMs === 'number' && Number.isFinite(parsed.moraTimingOffsetMs)
          ? Math.min(200, Math.max(-200, parsed.moraTimingOffsetMs))
          : DEFAULT_RENDER_SETTINGS.moraTimingOffsetMs,
    }
  } catch {
    return DEFAULT_RENDER_SETTINGS
  }
}

function save(settings: RenderSettings) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private mode などで localStorage が無効でも UI は動かす。
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

/**
 * 端末ごとに保存したいクライアント側のレンダリング設定。
 * SettingsView と VRMCanvas の双方から参照されるため、保存時は同一タブの他インスタンスへ
 * カスタムイベントで通知して再読み込みさせる。
 */
export function useRenderSettings(): {
  settings: RenderSettings
  update: (patch: Partial<RenderSettings>) => void
} {
  const [settings, setSettings] = useState<RenderSettings>(() => load())

  useEffect(() => {
    const handler = () => setSettings(load())
    window.addEventListener(EVENT_NAME, handler)
    // 別タブからの変更も拾う（同一タブからの場合 storage イベントは発火しない）。
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener(EVENT_NAME, handler)
      window.removeEventListener('storage', handler)
    }
  }, [])

  const update = (patch: Partial<RenderSettings>) => {
    const next = { ...load(), ...patch }
    save(next)
    setSettings(next)
  }

  return { settings, update }
}
