import type { App } from '@modelcontextprotocol/ext-apps'
import { useEffect, useState } from 'react'
import {
  type PlayerSettings,
  fetchPlayerSettingsOnServer,
  setPlayerSettingsOnServer,
} from '../hooks/vrmPlayerToolClient'

interface SettingsModalProps {
  app: App | null
  open: boolean
  busy: boolean
  onClose: () => void
  onOpenModels: () => void
  onApplied: () => Promise<void>
}

export function SettingsModal({ app, open, busy, onClose, onOpenModels, onApplied }: SettingsModalProps) {
  const [cliDefaults, setCliDefaults] = useState<PlayerSettings & { speedScale: number }>({ speedScale: 1 })
  const [values, setValues] = useState<PlayerSettings>({ speedScale: 1 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !app) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchPlayerSettingsOnServer(app)
      .then((settings) => {
        if (cancelled) return
        setCliDefaults(settings.cliDefaults)
        setValues({
          speedScale: settings.overrides.speedScale ?? settings.cliDefaults.speedScale,
          prePhonemeLength: settings.overrides.prePhonemeLength ?? settings.cliDefaults.prePhonemeLength ?? 0,
          postPhonemeLength: settings.overrides.postPhonemeLength ?? settings.cliDefaults.postPhonemeLength ?? 0,
        })
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, app])

  if (!open) return null

  const apply = async (reset = false) => {
    if (!app) return
    setLoading(true)
    setError(null)
    try {
      await setPlayerSettingsOnServer(app, reset ? { reset: true } : values)
      await onApplied()
      if (reset) {
        setValues({
          speedScale: cliDefaults.speedScale,
          prePhonemeLength: cliDefaults.prePhonemeLength ?? 0,
          postPhonemeLength: cliDefaults.postPhonemeLength ?? 0,
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="w-full max-w-md rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-[var(--ui-text)]">設定</div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[var(--ui-text-secondary)] hover:text-[var(--ui-text)]"
          >
            閉じる
          </button>
        </div>

        <div className="space-y-3">
          <SettingNumber
            label="再生速度"
            value={values.speedScale ?? cliDefaults.speedScale}
            min={0.5}
            max={2}
            step={0.05}
            defaultValue={cliDefaults.speedScale}
            onChange={(speedScale) => setValues((prev) => ({ ...prev, speedScale }))}
          />
          <SettingNumber
            label="前の空白"
            value={values.prePhonemeLength ?? 0}
            min={0}
            max={2}
            step={0.05}
            defaultValue={cliDefaults.prePhonemeLength}
            onChange={(prePhonemeLength) => setValues((prev) => ({ ...prev, prePhonemeLength }))}
          />
          <SettingNumber
            label="後の空白"
            value={values.postPhonemeLength ?? 0}
            min={0}
            max={2}
            step={0.05}
            defaultValue={cliDefaults.postPhonemeLength}
            onChange={(postPhonemeLength) => setValues((prev) => ({ ...prev, postPhonemeLength }))}
          />
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => void apply(false)}
            className="rounded-md border border-[var(--ui-accent)] bg-[var(--ui-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--ui-accent-hover)] disabled:opacity-50"
          >
            {loading ? '適用中...' : '適用'}
          </button>
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => void apply(true)}
            className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-3 py-1.5 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)] disabled:opacity-50"
          >
            リセット
          </button>
          <button
            type="button"
            onClick={onOpenModels}
            className="ml-auto rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-3 py-1.5 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
          >
            モデル管理
          </button>
        </div>
      </div>
    </div>
  )
}

function SettingNumber({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  defaultValue?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block text-xs text-[var(--ui-text)]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold">{label}</span>
        <span className="text-[var(--ui-text-secondary)]">既定: {defaultValue ?? 'VOICEVOX'}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="vv-slider min-w-0 flex-1"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number(value.toFixed(2))}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-20 rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-right text-xs text-[var(--ui-text)]"
        />
      </div>
    </label>
  )
}
