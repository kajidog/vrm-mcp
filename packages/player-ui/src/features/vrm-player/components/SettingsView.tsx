import type { App } from '@modelcontextprotocol/ext-apps'
import { useEffect, useState } from 'react'
import {
  type PlayerSettings,
  fetchPlayerSettingsOnServer,
  setPlayerSettingsOnServer,
} from '../hooks/vrmPlayerToolClient'

interface SettingsViewProps {
  app: App
  busy: boolean
  onBack: () => void
  onOpenPoses: () => void
  onApplied: () => Promise<void>
}

export function SettingsView({ app, busy, onBack, onOpenPoses, onApplied }: SettingsViewProps) {
  const [cliDefaults, setCliDefaults] = useState<PlayerSettings & { speedScale: number; autoPlay: boolean }>({
    speedScale: 1,
    autoPlay: true,
    usePublicVrms: true,
  })
  const [values, setValues] = useState<PlayerSettings>({ speedScale: 1, autoPlay: true, usePublicVrms: true })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
          autoPlay: settings.overrides.autoPlay ?? settings.cliDefaults.autoPlay,
          usePublicVrms: settings.overrides.usePublicVrms ?? settings.cliDefaults.usePublicVrms ?? true,
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
  }, [app])

  const apply = async (reset = false) => {
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
          autoPlay: cliDefaults.autoPlay,
          usePublicVrms: cliDefaults.usePublicVrms ?? true,
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
        >
          戻る
        </button>
        <div className="text-sm font-semibold text-[var(--ui-text)]">設定</div>

        <div />
      </div>

      <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4">
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
          <SettingToggle
            label="自動再生"
            checked={values.autoPlay ?? cliDefaults.autoPlay}
            defaultValue={cliDefaults.autoPlay}
            onChange={(autoPlay) => setValues((prev) => ({ ...prev, autoPlay }))}
          />
          <SettingToggle
            label="公開VRMを使用"
            checked={values.usePublicVrms ?? cliDefaults.usePublicVrms ?? true}
            defaultValue={cliDefaults.usePublicVrms ?? true}
            onChange={(usePublicVrms) => setValues((prev) => ({ ...prev, usePublicVrms }))}
          />
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
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
            disabled={loading || busy}
            onClick={() => void apply(false)}
            className="rounded-md border border-[var(--ui-accent)] bg-[var(--ui-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--ui-accent-hover)] disabled:opacity-50"
          >
            {loading ? '適用中...' : '適用'}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenPoses}
        className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-3 py-1.5 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
      >
        ポーズ管理
      </button>
    </div>
  )
}

function SettingToggle({
  label,
  checked,
  defaultValue,
  onChange,
}: {
  label: string
  checked: boolean
  defaultValue: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-[var(--ui-text)]">
      <div>
        <div className="font-semibold">{label}</div>
        <div className="text-[var(--ui-text-secondary)]">既定: {defaultValue ? 'ON' : 'OFF'}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[var(--ui-accent)]"
      />
    </label>
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
