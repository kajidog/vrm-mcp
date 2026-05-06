import { useEffect, useMemo, useState } from 'react'
import { VRMCanvas } from '../vrm-player/components/VRMCanvas'
import type { VrmSource } from '../vrm-player/types'
import type { RegisterPoseRequest } from './hooks/usePoseRegistry'
import { isBuiltinPoseResourceId } from './presets'
import type { PoseMetadata, PoseSource } from './types'

interface PoseRegisterModalProps {
  existingIds: string[]
  saving?: boolean
  // 親で表示中の VRM。未指定（VRM 未選択時）はプレビュー枠に注意書きを出す。
  previewSource?: VrmSource | null
  onClose: () => void
  onRegister: (input: RegisterPoseRequest) => Promise<PoseMetadata>
  onSaved?: (pose: PoseMetadata) => void
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function idFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function PoseRegisterModal({
  existingIds,
  saving = false,
  previewSource = null,
  onClose,
  onRegister,
  onSaved,
}: PoseRegisterModalProps) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [loop, setLoop] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [vrmaData, setVrmaData] = useState<ArrayBuffer | null>(null)

  // 選択中の .vrma を blob URL にしてプレビュー用 PoseSource として VRMCanvas に渡す。
  // VRM 本体は親のソースをそのまま使う。
  // sandbox 環境では blob: URL の fetch が失敗するため、ArrayBuffer が揃ってから
  // 同時に URL も公開してプレビュー側を必ず parse 経路に通す。
  const [vrmaUrl, setVrmaUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file) {
      setVrmaUrl(null)
      setVrmaData(null)
      return
    }
    let cancelled = false
    let url: string | null = null
    void file.arrayBuffer().then((buffer) => {
      if (cancelled) return
      url = URL.createObjectURL(file)
      setVrmaData(buffer)
      setVrmaUrl(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file])

  const previewPose = useMemo<PoseSource | null>(() => {
    if (!vrmaUrl || !vrmaData) return null
    return {
      kind: 'vrma',
      id: 'pose-register-preview',
      resourceId: 'pose-register-preview',
      vrmaUrl,
      vrmaData,
      loop,
    }
  }, [vrmaUrl, vrmaData, loop])

  const setPoseFile = (nextFile: File | null) => {
    if (nextFile && !nextFile.name.toLowerCase().endsWith('.vrma')) {
      setError('.vrma ファイルを選択してください。')
      return
    }
    setError(null)
    setPreviewError(null)
    setFile(nextFile)
    if (nextFile && !id.trim()) setId(idFromFileName(nextFile.name))
  }

  const save = async () => {
    setError(null)
    const trimmedId = id.trim()
    if (!trimmedId) {
      setError('ID を入力してください。')
      return
    }
    if (trimmedId.startsWith('builtin:') || isBuiltinPoseResourceId(trimmedId)) {
      setError('builtin: は予約済みです。')
      return
    }
    if (existingIds.includes(trimmedId)) {
      setError('同じ ID の pose が既にあります。')
      return
    }
    if (!file) {
      setError('.vrma ファイルを選択してください。')
      return
    }

    setSubmitting(true)
    try {
      const buffer = await file.arrayBuffer()
      const created = await onRegister({
        id: trimmedId,
        name: name.trim() || undefined,
        loop,
        vrmaBase64: arrayBufferToBase64(buffer),
      })
      onSaved?.(created)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = saving || submitting

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="relative max-h-[calc(100vh-32px)] w-full max-w-6xl overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-[var(--ui-text)]">ポーズを追加</div>
          <button
            type="button"
            onClick={onClose}
            disabled={disabled}
            className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)] disabled:opacity-50"
          >
            閉じる
          </button>
        </div>

        {error ? (
          <div className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>
        ) : null}

        <div className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,7fr)_minmax(280px,3fr)]">
          {/* 左ペイン: プレビュー兼 .vrma ドロップエリア */}
          <div
            className="space-y-2"
            onDragEnter={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
              if (!dragging) setDragging(true)
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
              setDragging(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              setPoseFile(event.dataTransfer.files?.[0] ?? null)
            }}
          >
            <div className="flex h-8 items-center justify-between">
              <div className="text-xs font-semibold text-[var(--ui-text)]">プレビュー</div>
              <div className="text-[11px] text-[var(--ui-text-secondary)]">
                {file ? '.vrma をドロップで差し替え' : '.vrma ファイルをここへドロップ'}
              </div>
            </div>
            {previewSource ? (
              <div
                className={`relative overflow-hidden rounded-md border bg-[var(--ui-bg)] ${
                  dragging ? 'border-[var(--ui-accent)] ring-2 ring-[var(--ui-accent)]/40' : 'border-[var(--ui-border)]'
                }`}
              >
                <VRMCanvas
                  source={previewSource}
                  onError={setPreviewError}
                  pose={previewPose}
                  speechText={null}
                  heightClassName="h-[min(68vh,640px)] min-h-[420px]"
                />
                {dragging ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 text-xs font-semibold text-white">
                    .vrma ファイルをドロップ
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                className={`rounded-md border border-dashed p-6 text-center text-[11px] text-[var(--ui-text-secondary)] ${
                  dragging ? 'border-[var(--ui-accent)]' : 'border-[var(--ui-border)]'
                }`}
              >
                VRM を選択するとプレビューできます。
              </div>
            )}
            {previewError ? <div className="text-[11px] text-red-600">{previewError}</div> : null}
          </div>

          {/* 右ペイン: フォーム */}
          <div className="grid content-start gap-3 text-xs">
            <div className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-bg)] p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-semibold text-[var(--ui-text)]">.vrma ファイル</span>
                <label className="inline-flex cursor-pointer rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-[var(--ui-text)] hover:border-[var(--ui-accent)]">
                  ファイルを選択
                  <input
                    type="file"
                    accept=".vrma,model/gltf-binary"
                    onChange={(event) => setPoseFile(event.target.files?.[0] ?? null)}
                    className="hidden"
                  />
                </label>
              </div>
              <div className="truncate text-[11px] text-[var(--ui-text-secondary)]">{file ? file.name : '未選択'}</div>
            </div>

            <label className="grid gap-1">
              <span className="font-semibold text-[var(--ui-text)]">ポーズID</span>
              <input
                value={id}
                onChange={(event) => setId(event.target.value)}
                placeholder="例: happy-wave"
                className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
              />
            </label>
            <label className="grid gap-1">
              <span className="font-semibold text-[var(--ui-text)]">表示名</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="任意"
                className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-[var(--ui-text)]">
              <input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />
              ループ再生
            </label>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void save()}
              className="mt-2 rounded-md border border-[var(--ui-accent)] bg-[var(--ui-accent)] px-3 py-3 text-sm font-semibold text-white hover:bg-[var(--ui-accent-hover)] disabled:opacity-50"
            >
              {disabled ? '保存中...' : 'ポーズを登録'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
