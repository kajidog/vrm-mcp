import type { App } from '@modelcontextprotocol/ext-apps'
import { useEffect, useMemo, useState } from 'react'
import { VRMCanvas } from '../vrm-player/components/VRMCanvas'
import type { VrmSource } from '../vrm-player/types'
import { useVrmRegistry } from '../vrm-registry/hooks/useVrmRegistry'
import type { VrmMetadata } from '../vrm-registry/types'
import { PoseRegisterModal } from './PoseRegisterModal'
import { usePoseRegistry } from './hooks/usePoseRegistry'
import { isBuiltinPoseResourceId } from './presets'
import type { PoseMetadata, PoseSource } from './types'

interface PoseListViewProps {
  app: App
  onBack: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function PoseListView({ app, onBack }: PoseListViewProps) {
  const { poses, poseLibrary, loading, error, register, update, remove } = usePoseRegistry(app)
  const { vrms } = useVrmRegistry(app)
  const [selectedId, setSelectedId] = useState<string>('builtin:idle')
  const [previewSource, setPreviewSource] = useState<VrmSource | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Record<string, { name: string; loop: boolean }>>({})

  const selectedPose = poseLibrary.get(selectedId) ?? null
  const defaultModel = useMemo(() => vrms.find((vrm) => vrm.isDefault) ?? vrms[0] ?? null, [vrms])

  useEffect(() => {
    if (!defaultModel) return
    let cancelled = false
    void app
      .callServerTool({ name: '_get_vrm_for_player', arguments: { modelId: defaultModel.id } })
      .then((result) => {
        if (cancelled || result.isError) return
        const text = result.content?.find((content) => content.type === 'text')
        if (text?.type !== 'text') return
        const parsed = JSON.parse(text.text) as { vrmUrl?: string; metadata?: VrmMetadata }
        if (parsed.vrmUrl) setPreviewSource({ src: parsed.vrmUrl, label: parsed.metadata?.name ?? defaultModel.name })
      })
      .catch((e: unknown) => setPreviewError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [app, defaultModel])

  const saveEdit = async (pose: PoseMetadata) => {
    const values = editing[pose.id]
    if (!values) return
    try {
      await update(pose.id, { name: values.name.trim() || undefined, loop: values.loop })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
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
          ← 戻る
        </button>
        <div className="text-sm font-semibold text-[var(--ui-text)]">ポーズ管理</div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="rounded-md border border-[var(--ui-accent)] bg-[var(--ui-accent)] px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--ui-accent-hover)]"
        >
          新規追加
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}
      {formError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError}</div>
      ) : null}

      {formOpen ? (
        <PoseRegisterModal
          existingIds={poses.map((pose) => pose.id)}
          onClose={() => setFormOpen(false)}
          onRegister={register}
          onSaved={(pose) => setSelectedId(pose.id)}
        />
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
          <div className="mb-2 text-xs font-semibold text-[var(--ui-text)]">
            {loading ? '読み込み中...' : `${poses.length} poses`}
          </div>
          <div className="space-y-1">
            {poses.map((pose) => {
              const builtin = isBuiltinPoseResourceId(pose.id)
              const edit = editing[pose.id] ?? { name: pose.name ?? '', loop: pose.loop }
              return (
                <div
                  key={pose.id}
                  className={`grid gap-2 rounded-md border p-2 text-xs ${selectedId === pose.id ? 'border-[var(--ui-accent)] bg-[var(--ui-accent)]/10' : 'border-[var(--ui-border)]'}`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(pose.id)}
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-left"
                  >
                    <span className="truncate font-semibold text-[var(--ui-text)]">{pose.id}</span>
                    <span className="rounded bg-[var(--ui-tag-bg)] px-1.5 py-0.5 text-[var(--ui-text-secondary)]">
                      {pose.loop ? 'loop' : 'once'}
                    </span>
                    <span className="text-[var(--ui-text-secondary)]">{formatBytes(pose.sizeBytes)}</span>
                  </button>
                  {!builtin ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={edit.name}
                        onChange={(e) =>
                          setEditing((prev) => ({ ...prev, [pose.id]: { ...edit, name: e.target.value } }))
                        }
                        placeholder="name"
                        className="min-w-0 flex-1 rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-[var(--ui-text)]"
                      />
                      <label className="flex items-center gap-1 text-[var(--ui-text)]">
                        <input
                          type="checkbox"
                          checked={edit.loop}
                          onChange={(e) =>
                            setEditing((prev) => ({ ...prev, [pose.id]: { ...edit, loop: e.target.checked } }))
                          }
                        />
                        loop
                      </label>
                      <button
                        type="button"
                        onClick={() => void saveEdit(pose)}
                        className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
                      >
                        更新
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(pose.id)}
                        className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-[var(--ui-danger)] hover:border-[var(--ui-danger)]"
                      >
                        削除
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
          <div className="mb-2 text-xs font-semibold text-[var(--ui-text)]">プレビュー</div>
          {previewError ? <div className="mb-2 text-xs text-red-600">{previewError}</div> : null}
          {previewSource && selectedPose ? (
            <VRMCanvas source={previewSource} onError={setPreviewError} pose={selectedPose} speechText={null} />
          ) : (
            <div className="rounded-md border border-dashed border-[var(--ui-border)] p-6 text-center text-xs text-[var(--ui-text-secondary)]">
              デフォルト VRM がありません。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
