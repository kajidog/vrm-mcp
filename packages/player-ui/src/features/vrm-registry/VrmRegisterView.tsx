import type { App } from '@modelcontextprotocol/ext-apps'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DeleteIcon, PlayIcon } from '~/icons'
import { PoseRegisterModal } from '../poses/PoseRegisterModal'
import { usePoseRegistry } from '../poses/hooks/usePoseRegistry'
import { DEFAULT_POSE_ID, POSE_PRESETS } from '../poses/presets'
import type { ModelPoseAttachment } from '../poses/types'
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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

  return uuid ? (portraits[uuid] ?? null) : null
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

// React の reconciliation で「ポーズ名」入力欄がリレンダ毎にアンマウントされないように、
// グループキーは attachment 単位で永続な _key を割り当てる。バックエンドへ送るときは strip。
interface FormAttachment extends ModelPoseAttachment {
  _key: string
}

interface FormState {
  name: string
  speakerId: number | null
  isDefault: boolean
  isPublic: boolean
  poses: FormAttachment[]
}

let attachmentKeyCounter = 0
const nextAttachmentKey = () => `att-${++attachmentKeyCounter}`

const INITIAL_FORM: FormState = {
  name: '',
  speakerId: null,
  isDefault: false,
  isPublic: false,
  poses: Object.keys(POSE_PRESETS).map((id) => ({
    _key: nextAttachmentKey(),
    poseId: `builtin:${id}`,
    name: id,
  })),
}

const stripAttachmentKeys = (poses: FormAttachment[]): ModelPoseAttachment[] => poses.map(({ _key, ...rest }) => rest)

const withAttachmentKeys = (poses: ModelPoseAttachment[]): FormAttachment[] =>
  poses.map((pose) => ({ ...pose, _key: nextAttachmentKey() }))

/**
 * VRM 登録/編集画面。
 * - modelId === null: 新規登録（VRM ファイル必須）
 * - modelId !== null: メタ編集（VRM ファイル差し替え可、未選択なら既存 VRM を HTTP URL でプレビュー）
 */
export function VrmRegisterView({ app, modelId, onBack, onSaved }: VrmRegisterViewProps) {
  const isEdit = modelId !== null
  const { vrms, register, update, replaceBinary, remove } = useVrmRegistry(app)
  const { poses: availablePoses, poseLibrary, register: registerPose } = usePoseRegistry(app)
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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [poseFormOpen, setPoseFormOpen] = useState(false)
  // プレビュー時の確認用ポーズ。保存する値ではないので form 外に持つ。
  const [previewPoseId, setPreviewPoseId] = useState(`builtin:${DEFAULT_POSE_ID}`)

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
      poses: withAttachmentKeys(metadata.poses ?? stripAttachmentKeys(INITIAL_FORM.poses)),
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
      }
    : vrmBuffer
      ? {
          data: vrmBuffer,
          label: vrmFileName ?? 'VRM',
          note: 'プレビュー中',
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
      const persistedPoses = stripAttachmentKeys(form.poses)
      if (isEdit && modelId) {
        await update(modelId, {
          name: form.name.trim(),
          speakerId: form.speakerId,
          isDefault: form.isDefault,
          isPublic: form.isPublic,
          poses: persistedPoses,
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
          poses: persistedPoses,
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

  const handleDelete = useCallback(async () => {
    if (!isEdit || !modelId) return
    setDeleteError(null)
    setDeleting(true)
    try {
      await remove(modelId)
      setConfirmDeleteOpen(false)
      onSaved()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }, [isEdit, modelId, remove, onSaved])

  const dropProps = drop.dropHandlers
  const dragHighlight = drop.isDragging
  const previewPose = poseLibrary.get(previewPoseId) ?? poseLibrary.get(`builtin:${DEFAULT_POSE_ID}`) ?? null
  const firstPoseId = availablePoses[0]?.id ?? `builtin:${DEFAULT_POSE_ID}`
  const poseSectionDisabled = !isEdit && !vrmBuffer

  // 新しく追加したポーズグループのポーズ名 input に focus を当てるため、
  // group の最初の attachment の `_key` を一意な「グループキー」として保持する。
  // _key は名前変更で変わらないので、入力中にアンマウントが起きない。
  const poseGroups = useMemo(() => {
    const groups: Array<{
      key: string
      name: string
      items: Array<{ attachment: FormAttachment; index: number }>
    }> = []
    for (const [index, attachment] of form.poses.entries()) {
      const groupName = attachment.name
      let group = groups.find((entry) => entry.name === groupName)
      if (!group) {
        group = { key: attachment._key, name: groupName, items: [] }
        groups.push(group)
      }
      group.items.push({ attachment, index })
    }
    return groups
  }, [form.poses])

  const poseLabel = (poseId: string) => {
    const pose = availablePoses.find((entry) => entry.id === poseId)
    return pose?.name ? `${pose.name} (${pose.id})` : poseId
  }

  const groupNameRefs = useRef<Map<string, HTMLInputElement | null>>(new Map())
  const [pendingFocusGroupKey, setPendingFocusGroupKey] = useState<string | null>(null)

  // 新規グループ追加 → そのグループのポーズ名 input にフォーカスして全選択する。
  // ref callback で groupNameRefs.current に登録された時点で commit が終わっているので、
  // pendingFocusGroupKey の変化のみを依存にすれば良い。
  useEffect(() => {
    if (!pendingFocusGroupKey) return
    const el = groupNameRefs.current.get(pendingFocusGroupKey)
    if (el) {
      el.focus()
      el.select()
      setPendingFocusGroupKey(null)
    }
  }, [pendingFocusGroupKey])

  const renamePoseGroup = (oldName: string, nextName: string) => {
    setForm((prev) => ({
      ...prev,
      poses: prev.poses.map((pose) => (pose.name === oldName ? { ...pose, name: nextName } : pose)),
    }))
  }

  const changeAttachmentPoseId = (index: number, poseId: string) => {
    if (!poseId) return
    setForm((prev) => ({
      ...prev,
      poses: prev.poses.map((pose, i) => (i === index ? { ...pose, poseId } : pose)),
    }))
    setPreviewPoseId(poseId)
  }

  const addVariationToGroup = (groupName: string) => {
    const poseId = firstPoseId
    setForm((prev) => ({
      ...prev,
      poses: [...prev.poses, { _key: nextAttachmentKey(), poseId, name: groupName }],
    }))
    setPreviewPoseId(poseId)
  }

  const addPoseGroup = () => {
    // 既存のグループ名と被らない初期値を作る。日本語のプレースホルダにしておくと
    // ユーザがそのまま選択 → 入力で上書きしやすい。
    const taken = new Set(form.poses.map((pose) => pose.name))
    let candidate = '新規ポーズ'
    let n = 2
    while (taken.has(candidate)) {
      candidate = `新規ポーズ ${n++}`
    }
    const key = nextAttachmentKey()
    setForm((prev) => ({
      ...prev,
      poses: [...prev.poses, { _key: key, poseId: firstPoseId, name: candidate }],
    }))
    setPreviewPoseId(firstPoseId)
    setPendingFocusGroupKey(key)
  }

  const removeAttachmentAt = (index: number) => {
    setForm((prev) => ({ ...prev, poses: prev.poses.filter((_, poseIndex) => poseIndex !== index) }))
  }

  return (
    <div
      className={`relative space-y-3 p-3 ${
        dragHighlight ? 'outline-2 outline-offset-[-6px] outline-[var(--ui-accent)]' : ''
      }`}
      {...dropProps}
    >
      <input {...drop.inputProps} />
      <div className="flex items-center justify-between rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
        >
          ← キャンセル
        </button>
        <div className="text-sm font-semibold text-[var(--ui-text)]">{isEdit ? 'VRM を編集' : 'VRM を追加'}</div>
        <div className="flex items-center gap-1.5">
          {isEdit ? (
            <button
              type="button"
              title="削除"
              onClick={() => {
                setDeleteError(null)
                setConfirmDeleteOpen(true)
              }}
              disabled={saving || loadingExisting || deleting}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] text-[var(--ui-danger)] hover:border-[var(--ui-danger)] disabled:opacity-50"
            >
              <DeleteIcon />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loadingExisting || deleting}
            className="rounded-md border border-[var(--ui-accent)] bg-[var(--ui-accent)] px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--ui-accent-hover)] disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
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

      {deleteError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{deleteError}</div>
      ) : null}

      <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        {/* プレビューと VRM ファイル選択を 1 つのカードに統合。ドロップ領域もこのカード内に置く。 */}
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="text-xs font-semibold text-[var(--ui-text)]">プレビュー</div>
              <div className="truncate text-[11px] text-[var(--ui-text-secondary)]">
                {vrmFileName ? (
                  <>
                    {vrmFileName} <span className="ml-1">{formatBytes(vrmSize)}</span>
                  </>
                ) : (
                  'ここに .vrm ファイルをドロップ'
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {previewError ? <div className="truncate text-xs text-red-600">{previewError}</div> : null}
              <button
                type="button"
                onClick={() => drop.openFilePicker()}
                className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
              >
                {isEdit ? 'モデルを変更' : 'ファイルを選択'}
              </button>
            </div>
          </div>
          {previewSource ? (
            <VRMCanvas
              source={previewSource}
              onError={setPreviewError}
              pose={previewPose}
              speechText={null}
              heightClassName="h-[min(62vh,620px)] min-h-[420px]"
            />
          ) : isEdit ? (
            <div className="flex h-[420px] items-center justify-center rounded-md border border-dashed border-[var(--ui-border)] text-center text-xs text-[var(--ui-text-secondary)]">
              既存 VRM のプレビューURLを取得しています。
            </div>
          ) : (
            <div className="flex h-[420px] items-center justify-center rounded-md border border-dashed border-[var(--ui-border)] text-center text-xs text-[var(--ui-text-secondary)]">
              VRM ファイルをドロップまたは選択するとプレビューできます。
            </div>
          )}
        </div>

        {/* ポーズはプレビューの隣に配置し、高さは VRM プレビューと揃える（はみ出した分はスクロール）。 */}
        <div
          className={`relative flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3 transition-opacity ${
            poseSectionDisabled ? 'pointer-events-none opacity-50' : ''
          }`}
          aria-disabled={poseSectionDisabled}
        >
          <div className="flex min-h-9 items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-[var(--ui-text)]">ポーズ</div>
              <div className="text-[11px] leading-relaxed text-[var(--ui-text-secondary)]">
                MCP
                からポーズ名で呼び出します。同じポーズ名にバリエーションを複数登録すると、再生のたびに自動で切り替わります。
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPoseFormOpen(true)}
              disabled={poseSectionDisabled}
              className="shrink-0 rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)] disabled:opacity-50"
            >
              ポーズを登録
            </button>
          </div>

          {poseFormOpen ? (
            <PoseRegisterModal
              existingIds={availablePoses.map((pose) => pose.id)}
              saving={saving}
              previewSource={previewSource}
              onClose={() => setPoseFormOpen(false)}
              onRegister={registerPose}
            />
          ) : null}

          {poseSectionDisabled ? (
            <div className="rounded-md border border-dashed border-[var(--ui-border)] p-4 text-center text-xs text-[var(--ui-text-secondary)]">
              VRM ファイルを選択するとポーズを編集できます。
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {poseGroups.map((group) => (
                  <div
                    key={group.key}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg)] p-2"
                  >
                    <label className="flex flex-col gap-1">
                      <span className="block text-[11px] text-[var(--ui-text-secondary)]">ポーズ名</span>
                      <input
                        ref={(el) => {
                          if (el) groupNameRefs.current.set(group.key, el)
                          else groupNameRefs.current.delete(group.key)
                        }}
                        value={group.name}
                        onChange={(event) => renamePoseGroup(group.name, event.target.value)}
                        placeholder="例: happy"
                        className="h-10 w-full min-w-0 rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 text-sm font-semibold text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
                      />
                    </label>
                    <div className="flex flex-col gap-1.5 self-start">
                      <span className="block text-[11px] text-[var(--ui-text-secondary)]">バリエーション</span>
                      {group.items.map(({ attachment, index }) => {
                        const active = previewPoseId === attachment.poseId
                        return (
                          <div
                            key={attachment._key}
                            className={`grid h-10 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 rounded-md border bg-[var(--ui-button-bg)] px-2 ${
                              active ? 'border-[var(--ui-accent)]' : 'border-[var(--ui-border)]'
                            }`}
                          >
                            <select
                              value={attachment.poseId}
                              onChange={(event) => changeAttachmentPoseId(index, event.target.value)}
                              className="min-w-0 truncate rounded border border-transparent bg-transparent text-xs text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
                            >
                              {availablePoses.map((pose) => (
                                <option
                                  key={pose.id}
                                  value={pose.id}
                                  className="bg-[var(--ui-button-bg)] text-[var(--ui-text)]"
                                >
                                  {poseLabel(pose.id)}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              title="プレビュー"
                              onClick={() => setPreviewPoseId(attachment.poseId)}
                              className={`flex h-7 w-7 items-center justify-center rounded ${
                                active
                                  ? 'bg-[var(--ui-accent)] text-white'
                                  : 'text-[var(--ui-text-secondary)] hover:bg-[var(--ui-tag-bg)] hover:text-[var(--ui-text)]'
                              }`}
                            >
                              <PlayIcon />
                            </button>
                            <button
                              type="button"
                              title="削除"
                              onClick={() => removeAttachmentAt(index)}
                              className="flex h-7 w-7 items-center justify-center rounded text-[var(--ui-danger)] hover:bg-[var(--ui-tag-bg)]"
                            >
                              <DeleteIcon />
                            </button>
                          </div>
                        )
                      })}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => addVariationToGroup(group.name)}
                          disabled={availablePoses.length === 0}
                          className="rounded-md border border-dashed border-[var(--ui-border)] px-2 py-1 text-[11px] text-[var(--ui-text-secondary)] hover:border-[var(--ui-accent)] hover:text-[var(--ui-text)] disabled:opacity-50"
                        >
                          + バリエーション
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {poseGroups.length === 0 ? (
                  <div className="rounded-md border border-dashed border-[var(--ui-border)] p-4 text-center text-xs text-[var(--ui-text-secondary)]">
                    まだポーズが割り当てられていません。下の「+ 割り当てを追加」から作成してください。
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={addPoseGroup}
                  disabled={availablePoses.length === 0}
                  className="rounded-md border border-[var(--ui-accent)] bg-[var(--ui-accent)] px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--ui-accent-hover)] disabled:opacity-50"
                >
                  + 割り当てを追加
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3 md:grid-cols-2">
        <label className="block text-xs">
          <div className="mb-1 font-semibold text-[var(--ui-text)]">表示名</div>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="例: マイキャラ"
            className="w-full rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-2 text-sm text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
          />
        </label>

        <div className="text-xs">
          <div className="mb-1 font-semibold text-[var(--ui-text)]">話者</div>
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
              className="min-w-0 flex-1 rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-2 text-sm text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
            >
              <option value="">{speakersLoading ? '読み込み中...' : '選択してください'}</option>
              {speakers.map((s) => (
                <option key={`${s.uuid}-${s.id}`} value={s.id}>
                  {s.characterName}（{s.name}）
                </option>
              ))}
            </select>
          </div>
          {speakersError ? (
            <div className="mt-1 text-[11px] text-red-600">話者一覧の取得に失敗: {speakersError}</div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ui-text)] md:col-span-2">
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

      {confirmDeleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-sm rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg)] p-4 shadow-xl">
            <div className="text-sm font-semibold text-[var(--ui-text)]">VRM を削除しますか？</div>
            <div className="mt-2 text-xs leading-relaxed text-[var(--ui-text-secondary)]">
              「{form.name || vrmFileName || modelId}」を一覧から削除します。VRM ファイルも削除されます。
            </div>
            {deleteError ? <div className="mt-3 text-xs text-red-600">{deleteError}</div> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deleting}
                className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-3 py-1.5 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)] disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="rounded-md border border-[var(--ui-danger)] bg-[var(--ui-danger)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {deleting ? '削除中...' : '削除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
