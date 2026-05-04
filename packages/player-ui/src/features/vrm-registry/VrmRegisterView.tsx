import type { App } from '@modelcontextprotocol/ext-apps'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_POSE_ID, POSE_PRESETS, type PosePresetId } from '../poses/presets'
import { VRMCanvas } from '../vrm-player/components/VRMCanvas'
import { useVrmFileDrop } from '../vrm-player/hooks/useVrmFileDrop'
import type { VrmSource } from '../vrm-player/types'
import { useVrmRegistry } from './hooks/useVrmRegistry'
import type { VrmMetadata } from './types'

interface VrmRegisterViewProps {
  app: App
  modelId: string | null
  onBack: () => void
  onSaved: () => void
}

interface SpeakerStyle {
  id: number
  name: string
  characterName: string
  uuid: string
}

interface TextContent {
  type: 'text'
  text: string
}

function getTextPayload(content: unknown): string | null {
  if (!Array.isArray(content)) return null
  const text = content.find((c) => (c as { type?: string }).type === 'text') as TextContent | undefined
  return text?.type === 'text' ? text.text : null
}

function parseToolJson<T>(result: CallToolResult): T {
  if (result.isError) {
    throw new Error(getTextPayload(result.content) ?? 'Tool call failed')
  }
  const text = getTextPayload(result.content)
  if (!text) throw new Error('Tool returned no text content')
  return JSON.parse(text) as T
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  // 大きい VRM (数十 MB) でも btoa(String.fromCharCode(...)) が落ちないように分割エンコードする。
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// 音声テストのプリセット。長すぎず・キャラクター差が出る短いセリフを少数用意。
const TEST_PRESETS: ReadonlyArray<{ label: string; text: string }> = [
  { label: '挨拶', text: 'こんにちは、はじめまして。よろしくお願いします。' },
  { label: '質問', text: '今日はどんな話をしましょうか？' },
  { label: '相づち', text: 'なるほど、それは面白いですね。' },
  { label: 'カウント', text: '1、2、3、テスト中です。' },
  { label: '感情', text: 'やったー！うれしい！' },
]

// 話者ポートレート（キャラクター画像）のフェッチ + uuid 単位のメモリキャッシュ。
// 同じ uuid に対する重複リクエストを抑える。
function useSpeakerPortrait(app: App | null, uuid: string | null) {
  const [portraits, setPortraits] = useState<Record<string, string | null>>({})
  const inFlight = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!app || !uuid) return
    if (portraits[uuid] !== undefined) return
    if (inFlight.current.has(uuid)) return
    inFlight.current.add(uuid)
    let cancelled = false
    void app
      .callServerTool({ name: '_get_speaker_icon_for_player', arguments: { speakerUuid: uuid } })
      .then((result) => {
        if (cancelled) return
        const parsed = parseToolJson<{ portrait?: string | null }>(result)
        setPortraits((prev) => ({ ...prev, [uuid]: parsed.portrait ?? null }))
      })
      .catch(() => {
        if (cancelled) return
        // 取得失敗時は null を入れて再試行を抑止（プレースホルダーが描画される）。
        setPortraits((prev) => ({ ...prev, [uuid]: null }))
      })
      .finally(() => {
        inFlight.current.delete(uuid)
      })
    return () => {
      cancelled = true
    }
  }, [app, uuid, portraits])

  return uuid ? portraits[uuid] ?? null : null
}

function useSpeakers(app: App | null) {
  const [speakers, setSpeakers] = useState<SpeakerStyle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!app) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void app
      .callServerTool({ name: '_get_speakers_for_player', arguments: {} })
      .then((result) => {
        if (cancelled) return
        // _get_speakers_for_player は配列をそのまま JSON 文字列で返す。
        const list = parseToolJson<SpeakerStyle[]>(result)
        setSpeakers(Array.isArray(list) ? list : [])
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [app])

  return { speakers, loading, error }
}

interface FormState {
  name: string
  speakerId: number | null
  isDefault: boolean
  isPublic: boolean
}

const INITIAL_FORM: FormState = {
  name: '',
  speakerId: null,
  isDefault: false,
  isPublic: false,
}

/**
 * Phase 3: VRM 登録/編集画面。
 * - modelId === null: 新規登録（VRM ファイル必須）
 * - modelId !== null: メタ編集（VRM ファイル差し替え可、未選択なら既存 VRM を HTTP URL でプレビュー）
 *
 * プレビューと音声テストはフォーム入力中にその場で確認できる。
 */
export function VrmRegisterView({ app, modelId, onBack, onSaved }: VrmRegisterViewProps) {
  const isEdit = modelId !== null
  const { vrms, register, update, replaceBinary } = useVrmRegistry(app)
  const { speakers, loading: speakersLoading, error: speakersError } = useSpeakers(app)

  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [vrmBuffer, setVrmBuffer] = useState<ArrayBuffer | null>(null)
  const [existingVrmUrl, setExistingVrmUrl] = useState<string | null>(null)
  const [vrmFileName, setVrmFileName] = useState<string | null>(null)
  const [vrmSize, setVrmSize] = useState<number>(0)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loadingExisting, setLoadingExisting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testingLabel, setTestingLabel] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  // プレビュー時の確認用ポーズ。保存する値ではないので form 外に持つ。
  const [previewPose, setPreviewPose] = useState<PosePresetId>(DEFAULT_POSE_ID)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)

  // 選択中話者の uuid から portrait を引く（キャッシュは uuid 単位）。
  const selectedSpeaker = speakers.find((s) => s.id === form.speakerId) ?? null
  const portrait = useSpeakerPortrait(app, selectedSpeaker?.uuid ?? null)

  // 編集時: 一覧メタデータでフォームを埋め、VRM 本体は base64 ではなく HTTP URL でプレビューする。
  useEffect(() => {
    if (!isEdit || !modelId) return
    let cancelled = false
    setLoadingExisting(true)
    setSaveError(null)
    const metadata = vrms.find((vrm) => vrm.id === modelId)
    if (!metadata) {
      if (vrms.length > 0) {
        setSaveError('編集対象の VRM が見つかりませんでした。一覧に戻って再試行してください。')
        setLoadingExisting(false)
      }
      return
    }
    setForm({
      name: metadata.name,
      speakerId: metadata.speakerId,
      isDefault: metadata.isDefault,
      isPublic: metadata.isPublic,
    })
    setVrmBuffer(null)
    setExistingVrmUrl(null)
    setVrmSize(metadata.vrmSizeBytes)
    setVrmFileName(`${metadata.name}.vrm`)
    void app
      .callServerTool({ name: '_get_vrm_for_player', arguments: { modelId } })
      .then((result) => {
        if (cancelled) return
        const parsed = parseToolJson<{
          metadata: VrmMetadata
          vrmUrl?: string
          vrmMimeType?: string
        }>(result)
        if (!parsed.vrmUrl) {
          throw new Error('VRM URL が返りませんでした。HTTP mode で起動しているか確認してください。')
        }
        setExistingVrmUrl(parsed.vrmUrl)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setPreviewError(`VRM プレビューURLの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false)
      })
    return () => {
      cancelled = true
    }
  }, [isEdit, modelId, vrms, app])

  // 速度を考えて初回マウント時に話者の初期値を当てる（新規登録のみ）。
  useEffect(() => {
    if (isEdit) return
    if (form.speakerId !== null) return
    const first = speakers[0]
    if (first) setForm((prev) => ({ ...prev, speakerId: first.id }))
  }, [isEdit, speakers, form.speakerId])

  // テスト音声のオーディオ URL は使い回さず、再生のたびに作り直して revoke する。
  useEffect(() => {
    return () => {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current)
        audioUrlRef.current = null
      }
      const el = audioRef.current
      if (el) {
        el.pause()
      }
    }
  }, [])

  const onFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.vrm')) {
      setPreviewError('VRM ファイル（.vrm）を選択してください。')
      return
    }
    const buffer = await file.arrayBuffer()
    setVrmBuffer(buffer)
    setExistingVrmUrl(null)
    setVrmFileName(file.name)
    setVrmSize(buffer.byteLength)
    setPreviewError(null)
    // 名前が未入力なら、ファイル名から拡張子を除いた値を初期セットする。
    setForm((prev) => (prev.name ? prev : { ...prev, name: file.name.replace(/\.vrm$/i, '') }))
  }, [])

  const drop = useVrmFileDrop({ onFile })

  const previewSource: VrmSource | null = existingVrmUrl
    ? {
        src: existingVrmUrl,
        label: vrmFileName ?? '登録済み VRM',
        note: '登録済み VRM をプレビュー中',
        isLocal: true,
      }
    : vrmBuffer
      ? {
        data: vrmBuffer,
        label: vrmFileName ?? 'VRM',
        note: 'プレビュー中',
        isLocal: true,
      }
      : null

  const handleSave = useCallback(async () => {
    setSaveError(null)
    if (!form.name.trim()) {
      setSaveError('表示名を入力してください。')
      return
    }
    if (form.speakerId === null) {
      setSaveError('話者を選択してください。')
      return
    }
    if (!isEdit && !vrmBuffer) {
      setSaveError('VRM ファイルを選択してください。')
      return
    }
    setSaving(true)
    try {
      if (isEdit && modelId) {
        await update(modelId, {
          name: form.name.trim(),
          speakerId: form.speakerId,
          isDefault: form.isDefault,
          isPublic: form.isPublic,
        })
        if (vrmBuffer) {
          await replaceBinary(modelId, {
            vrmBase64: arrayBufferToBase64(vrmBuffer),
          })
        }
      } else if (vrmBuffer) {
        await register({
          name: form.name.trim(),
          speakerId: form.speakerId,
          isDefault: form.isDefault,
          isPublic: form.isPublic,
          vrmBase64: arrayBufferToBase64(vrmBuffer),
        })
      }
      onSaved()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [form, vrmBuffer, isEdit, modelId, register, update, replaceBinary, onSaved])

  const handleTestSpeak = useCallback(
    async (preset: { label: string; text: string }) => {
      if (form.speakerId === null) {
        setTestError('話者を選択してください。')
        return
      }
      setTestError(null)
      setTestingLabel(preset.label)
      try {
        const result = await app.callServerTool({
          name: '_test_speak_for_player',
          arguments: { speakerId: form.speakerId, text: preset.text },
        })
        const parsed = parseToolJson<{ audioBase64: string; audioMimeType?: string }>(result)
        const mime = parsed.audioMimeType ?? 'audio/wav'
        const bytes = base64ToArrayBuffer(parsed.audioBase64)
        const blob = new Blob([bytes], { type: mime })
        const url = URL.createObjectURL(blob)

        // 直前の URL を破棄してから差し替え（メモリリーク防止）。
        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
        audioUrlRef.current = url

        let audio = audioRef.current
        if (!audio) {
          audio = new Audio()
          audioRef.current = audio
        }
        audio.src = url
        await audio.play()
      } catch (e) {
        setTestError(e instanceof Error ? e.message : String(e))
      } finally {
        setTestingLabel(null)
      }
    },
    [app, form.speakerId]
  )

  const dropProps = drop.dropHandlers
  const dragHighlight = drop.isDragging

  return (
    <div
      className={`space-y-3 p-3 ${dragHighlight ? 'outline-2 outline-offset-[-6px] outline-[var(--ui-accent)]' : ''}`}
      {...dropProps}
    >
      <input {...drop.inputProps} />
      <div className="flex items-center justify-between rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
        >
          ← 一覧に戻る
        </button>
        <div className="text-sm font-semibold text-[var(--ui-text)]">{isEdit ? 'VRM を編集' : 'VRM を追加'}</div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || loadingExisting}
          className="rounded-md border border-[var(--ui-accent)] bg-[var(--ui-accent)] px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--ui-accent-hover)] disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      {loadingExisting ? (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3 text-sm text-[var(--ui-text-secondary)]">
          <div className="vv-spinner" />
          既存 VRM を読み込み中...
        </div>
      ) : null}

      {saveError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveError}</div>
      ) : null}

      {/* VRM ファイル / プレビュー */}
      <div className="space-y-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-[var(--ui-text)]">VRM ファイル</div>
          <button
            type="button"
            onClick={() => drop.openFilePicker()}
            className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
          >
            {isEdit ? 'モデルを変更' : 'ファイルを選択'}
          </button>
        </div>
        <div className="text-xs text-[var(--ui-text-secondary)]">
          {vrmFileName ? (
            <>
              {vrmFileName} <span className="ml-2">{formatBytes(vrmSize)}</span>
            </>
          ) : (
            'ここに .vrm ファイルをドロップ、または「ファイルを選択」'
          )}
        </div>
        {previewError ? <div className="text-xs text-red-600">{previewError}</div> : null}
        {previewSource ? (
          <>
            <VRMCanvas source={previewSource} onError={setPreviewError} pose={previewPose} />
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              <span className="font-semibold text-[var(--ui-text)]">ポーズ確認</span>
              <select
                value={previewPose}
                onChange={(e) => setPreviewPose(e.target.value as PosePresetId)}
                className="min-w-[8rem] rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
              >
                {Object.entries(POSE_PRESETS).map(([id, preset]) => (
                  <option key={id} value={id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-[var(--ui-text-secondary)]">
                プリセット動作確認用。保存はされません。
              </span>
            </div>
          </>
        ) : isEdit ? (
          <div className="rounded-md border border-dashed border-[var(--ui-border)] p-4 text-center text-xs text-[var(--ui-text-secondary)]">
            既存 VRM のプレビューURLを取得しています。
          </div>
        ) : null}
      </div>

      {/* メタ */}
      <div className="space-y-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
        <label className="block text-xs">
          <div className="mb-1 font-semibold text-[var(--ui-text)]">表示名</div>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="例: マイキャラ"
            className="w-full rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-sm text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
          />
        </label>

        <div className="text-xs">
          <div className="mb-1 font-semibold text-[var(--ui-text)]">話者</div>
          <div className="mb-1 text-[11px] text-[var(--ui-text-secondary)]">
            このモデルで TTS 合成するときの声。あとから「編集」でいつでも変更できます。
          </div>
          <div className="flex items-center gap-2">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--ui-border)] bg-[var(--ui-tag-bg)] text-[var(--ui-text-secondary)]">
              {portrait ? (
                <img
                  src={`data:image/png;base64,${portrait}`}
                  alt={selectedSpeaker?.characterName ?? 'Speaker'}
                  className="h-full w-full object-cover object-[center_top]"
                />
              ) : (
                <span className="text-[10px]">no img</span>
              )}
            </span>
            <select
              value={form.speakerId ?? ''}
              onChange={(e) => {
                const next = e.target.value === '' ? null : Number(e.target.value)
                setForm((prev) => ({ ...prev, speakerId: next }))
              }}
              disabled={speakersLoading}
              className="min-w-0 flex-1 rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-sm text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
            >
              <option value="">{speakersLoading ? '読み込み中...' : '選択してください'}</option>
              {speakers.map((s) => (
                <option key={`${s.uuid}-${s.id}`} value={s.id}>
                  {s.characterName}（{s.name}） / id: {s.id}
                </option>
              ))}
            </select>
          </div>
          {speakersError ? <div className="mt-1 text-[11px] text-red-600">話者一覧の取得に失敗: {speakersError}</div> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ui-text)]">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm((prev) => ({ ...prev, isDefault: e.target.checked }))}
            />
            デフォルトに設定
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(e) => setForm((prev) => ({ ...prev, isPublic: e.target.checked }))}
            />
            公開（予約フラグ）
          </label>
        </div>
      </div>

      {/* 音声テスト */}
      <div className="space-y-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-[var(--ui-text)]">音声テスト</div>
          {testingLabel ? <div className="text-[11px] text-[var(--ui-text-secondary)]">「{testingLabel}」合成中...</div> : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TEST_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.label}
              title={preset.text}
              onClick={() => void handleTestSpeak(preset)}
              disabled={testingLabel !== null || form.speakerId === null}
              className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)] disabled:opacity-50"
            >
              {preset.label}
            </button>
          ))}
        </div>
        {testError ? <div className="text-[11px] text-red-600">{testError}</div> : null}
      </div>
    </div>
  )
}
