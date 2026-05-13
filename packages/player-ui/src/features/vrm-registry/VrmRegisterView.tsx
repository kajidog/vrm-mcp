import type { App } from '@modelcontextprotocol/ext-apps'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EMOTION_NAMES, type EmotionBinding } from '../emotions'
import { usePoseRegistry } from '../poses/hooks/usePoseRegistry'
import { DEFAULT_POSE_ID, POSE_PRESETS } from '../poses/presets'
import type { ModelPoseAttachment } from '../poses/types'
import { useLipSync } from '../vrm-player/hooks/useLipSync'
import { useVrmFileDrop } from '../vrm-player/hooks/useVrmFileDrop'
import type { VrmSource } from '../vrm-player/types'
import { Accordion } from './components/Accordion'
import { ConfirmDeleteDialog } from './components/ConfirmDeleteDialog'
import { EmotionExpressionSection } from './components/EmotionExpressionSection'
import { EmotionSpeakerSection } from './components/EmotionSpeakerSection'
import { PoseAssignmentsSection, type PoseFormAttachment } from './components/PoseAssignmentsSection'
import { VrmInfoSection } from './components/VrmInfoSection'
import { VrmPreviewPanel } from './components/VrmPreviewPanel'
import { VrmRegisterHeader } from './components/VrmRegisterHeader'
import { useSpeakerPortrait } from './hooks/useSpeakerPortrait'
import { useSpeakers } from './hooks/useSpeakers'
import { useTestSpeakPlayer } from './hooks/useTestSpeakPlayer'
import { useVrmRegistry } from './hooks/useVrmRegistry'
import type { VrmMetadata } from './types'
import { arrayBufferToBase64 } from './utils/binary'
import { parseToolJson } from './utils/toolJson'

interface VrmRegisterViewProps {
  app: App
  modelId: string | null
  onBack: () => void
  onSaved: (modelId?: string) => void
  fullscreen?: boolean
  canFullscreen?: boolean
  onToggleFullscreen?: () => void
}

// React の reconciliation で「ポーズ名」入力欄がリレンダ毎にアンマウントされないように、
// グループキーは attachment 単位で永続な _key を割り当てる。
type FormAttachment = PoseFormAttachment

interface FormState {
  name: string
  speakerId: number | null
  isDefault: boolean
  isPublic: boolean
  poses: FormAttachment[]
  emotionBindings: EmotionBinding[]
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
  emotionBindings: EMOTION_NAMES.map((emotion) => ({ emotion, weight: 1 })),
}

const stripAttachmentKeys = (poses: FormAttachment[]): ModelPoseAttachment[] => poses.map(({ _key, ...rest }) => rest)

const withAttachmentKeys = (poses: ModelPoseAttachment[]): FormAttachment[] =>
  poses.map((pose) => ({ ...pose, _key: nextAttachmentKey() }))

function normalizeEmotionBindings(bindings: EmotionBinding[] | undefined): EmotionBinding[] {
  const byEmotion = new Map((bindings ?? []).map((binding) => [binding.emotion, binding]))
  return EMOTION_NAMES.map((emotion) => ({ emotion, weight: 1, ...byEmotion.get(emotion) }))
}

/**
 * VRM 登録/編集画面。
 * - modelId === null: 新規登録（VRM ファイル必須）
 * - modelId !== null: メタ編集（VRM ファイル差し替え可）
 *
 * 構成:
 *   sticky header  →  プレビュー(常時表示)  →  情報 / 感情→表情 / 感情→話者 / ポーズ (アコーディオン)
 *   fullscreen=true のときは情報以下を隠してプレビューだけを表示する。
 */
export function VrmRegisterView({
  app,
  modelId,
  onBack,
  onSaved,
  fullscreen = false,
  canFullscreen = false,
  onToggleFullscreen,
}: VrmRegisterViewProps) {
  const isEdit = modelId !== null
  const { vrms, register, update, replaceBinary, remove } = useVrmRegistry(app)
  const { poses: availablePoses, poseLibrary, register: registerPose } = usePoseRegistry(app)
  const { speakers, loading: speakersLoading, error: speakersError } = useSpeakers(app)
  const lipSync = useLipSync()
  const playSample = useTestSpeakPlayer(app, lipSync)

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
  const [previewPoseId, setPreviewPoseId] = useState(`builtin:${DEFAULT_POSE_ID}`)
  const [previewExpressionName, setPreviewExpressionName] = useState<string | null>(null)
  // null のあいだは form.speakerId をプレビューに使う。ユーザがプレビュー側で選んだら override する。
  const [previewSpeakerOverride, setPreviewSpeakerOverride] = useState<number | null>(null)
  const [availableExpressionNames, setAvailableExpressionNames] = useState<string[]>([])
  const [openSections, setOpenSections] = useState({
    info: true,
    expression: true,
    speaker: false,
    pose: false,
  })
  const sectionDefaultsAppliedRef = useRef(false)

  // 編集モードで loading 完了 (＝ form がメタデータで埋まった) のあとに 1 回だけ
  // 「未設定があれば開く」を計算する。新規モードでは即時計算 (INITIAL_FORM は全部未設定)。
  useEffect(() => {
    if (sectionDefaultsAppliedRef.current) return
    if (isEdit && loadingExisting) return
    if (isEdit && !form.name) return
    const hasUnsetExpression = form.emotionBindings.some((binding) => !binding.expressionName)
    setOpenSections((prev) => ({
      ...prev,
      expression: hasUnsetExpression,
    }))
    sectionDefaultsAppliedRef.current = true
  }, [isEdit, loadingExisting, form.name, form.emotionBindings])

  // VRM ロードで判明した表情名と感情名が一致したら、未設定の感情だけ自動で埋める。
  // ユーザが既に手で設定した値は上書きしない。VRM 差し替え時にも同じロジックが走る。
  useEffect(() => {
    if (availableExpressionNames.length === 0) return
    const lower = new Map(availableExpressionNames.map((name) => [name.toLowerCase(), name]))
    setForm((prev) => {
      let mutated = false
      const next = prev.emotionBindings.map((binding) => {
        if (binding.expressionName) return binding
        const match = lower.get(binding.emotion.toLowerCase())
        if (!match) return binding
        mutated = true
        return { ...binding, expressionName: match }
      })
      return mutated ? { ...prev, emotionBindings: next } : prev
    })
  }, [availableExpressionNames])

  const formSpeakerId = form.speakerId
  const previewSpeakerId = previewSpeakerOverride ?? formSpeakerId
  const selectedSpeaker = speakers.find((s) => s.id === formSpeakerId) ?? null
  const portrait = useSpeakerPortrait(app, selectedSpeaker?.uuid ?? null)

  // 編集時: 一覧メタデータでフォームを埋め、VRM 本体は HTTP URL でプレビューする。
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
      emotionBindings: normalizeEmotionBindings(metadata.emotionBindings),
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
          vrmBase64?: string
          vrmMimeType?: string
        }>(result)
        if (parsed.vrmBase64) {
          setExistingVrmUrl(`data:${parsed.vrmMimeType ?? 'model/gltf-binary'};base64,${parsed.vrmBase64}`)
          return
        }
        if (parsed.vrmUrl) {
          setExistingVrmUrl(parsed.vrmUrl)
          return
        }
        throw new Error('VRM データが返りませんでした。')
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

  // 新規登録時: 話者 select の初期値を先頭に当てる。
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
      let savedModelId: string | undefined
      const persistedPoses = stripAttachmentKeys(form.poses)
      const persistedEmotionBindings = form.emotionBindings.map((binding) => ({
        emotion: binding.emotion,
        ...(binding.expressionName?.trim() ? { expressionName: binding.expressionName.trim() } : {}),
        ...(binding.speakerId !== undefined ? { speakerId: binding.speakerId } : {}),
        ...(binding.weight !== undefined ? { weight: binding.weight } : {}),
      }))
      if (isEdit && modelId) {
        const updated = await update(modelId, {
          name: form.name.trim(),
          speakerId: form.speakerId,
          isDefault: form.isDefault,
          isPublic: form.isPublic,
          poses: persistedPoses,
          emotionBindings: persistedEmotionBindings,
        })
        savedModelId = updated.id
        if (vrmBuffer) {
          const replaced = await replaceBinary(modelId, {
            vrmBase64: arrayBufferToBase64(vrmBuffer),
          })
          savedModelId = replaced.id
        }
      } else if (vrmBuffer) {
        const created = await register({
          name: form.name.trim(),
          speakerId: form.speakerId,
          isDefault: form.isDefault,
          isPublic: form.isPublic,
          poses: persistedPoses,
          emotionBindings: persistedEmotionBindings,
          vrmBase64: arrayBufferToBase64(vrmBuffer),
        })
        savedModelId = created.id
      }
      onSaved(savedModelId)
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
  const previewExpression = previewExpressionName ? { name: previewExpressionName, weight: 1 } : null
  const firstPoseId = availablePoses[0]?.id ?? `builtin:${DEFAULT_POSE_ID}`
  const poseSectionDisabled = !isEdit && !vrmBuffer
  const expressionOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...availableExpressionNames,
          ...form.emotionBindings.flatMap((binding) => (binding.expressionName ? [binding.expressionName] : [])),
        ])
      ).sort(),
    [availableExpressionNames, form.emotionBindings]
  )

  // 新しく追加したポーズグループのポーズ名 input に focus を当てるため、グループキーを保持。
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

  const updateEmotionBinding = (emotion: EmotionBinding['emotion'], fields: Partial<EmotionBinding>) => {
    setForm((prev) => ({
      ...prev,
      emotionBindings: normalizeEmotionBindings(prev.emotionBindings).map((binding) =>
        binding.emotion === emotion ? { ...binding, ...fields } : binding
      ),
    }))
  }

  const handlePreviewSpeakerChange = (id: number) => {
    setPreviewSpeakerOverride(id)
    void playSample(id)
  }

  return (
    <div
      className={`relative ${fullscreen ? 'flex min-h-full flex-col gap-2 p-2' : 'space-y-3 p-3'} ${
        dragHighlight ? 'outline-2 outline-offset-[-6px] outline-[var(--ui-accent)]' : ''
      }`}
      {...dropProps}
    >
      <input {...drop.inputProps} />

      <VrmRegisterHeader
        isEdit={isEdit}
        fullscreen={fullscreen}
        canFullscreen={canFullscreen}
        saving={saving}
        loadingExisting={loadingExisting}
        deleting={deleting}
        onBack={onBack}
        onSave={() => void handleSave()}
        onRequestDelete={() => {
          setDeleteError(null)
          setConfirmDeleteOpen(true)
        }}
        onToggleFullscreen={onToggleFullscreen}
      />

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

      <VrmPreviewPanel
        source={previewSource}
        isEdit={isEdit}
        fullscreen={fullscreen}
        previewError={previewError}
        previewExpressionName={previewExpressionName}
        previewPoseId={previewPoseId}
        previewSpeakerId={previewSpeakerId}
        availableExpressionNames={availableExpressionNames}
        availablePoses={availablePoses}
        speakers={speakers}
        speakersLoading={speakersLoading}
        previewPose={previewPose}
        previewExpression={previewExpression}
        mouthRef={lipSync.mouthRef}
        onPreviewExpressionChange={setPreviewExpressionName}
        onPreviewPoseChange={setPreviewPoseId}
        onPreviewSpeakerChange={handlePreviewSpeakerChange}
        onError={setPreviewError}
        onExpressionsReady={setAvailableExpressionNames}
        openFilePicker={drop.openFilePicker}
        poseLabel={poseLabel}
      />

      <Accordion
        title="情報"
        open={openSections.info}
        onToggle={() => setOpenSections((prev) => ({ ...prev, info: !prev.info }))}
      >
        <VrmInfoSection
          name={form.name}
          speakerId={form.speakerId}
          isDefault={form.isDefault}
          isPublic={form.isPublic}
          speakers={speakers}
          speakersLoading={speakersLoading}
          speakersError={speakersError}
          portrait={portrait}
          selectedSpeaker={selectedSpeaker}
          vrmFileName={vrmFileName}
          vrmSize={vrmSize}
          isEdit={isEdit}
          onNameChange={(name) => setForm((prev) => ({ ...prev, name }))}
          onSpeakerChange={(speakerId) => setForm((prev) => ({ ...prev, speakerId }))}
          onDefaultChange={(nextIsDefault) => setForm((prev) => ({ ...prev, isDefault: nextIsDefault }))}
          onPublicChange={(nextIsPublic) => setForm((prev) => ({ ...prev, isPublic: nextIsPublic }))}
          openFilePicker={drop.openFilePicker}
        />
      </Accordion>

      <Accordion
        title="表情設定"
        open={openSections.expression}
        onToggle={() => setOpenSections((prev) => ({ ...prev, expression: !prev.expression }))}
        badge={
          <span className="text-[10px] font-normal text-[var(--ui-text-secondary)]">
            表情候補 {availableExpressionNames.length > 0 ? `${availableExpressionNames.length} 件` : '未検出'}{' '}
            VRMの表情の設定をします
          </span>
        }
      >
        <EmotionExpressionSection
          bindings={normalizeEmotionBindings(form.emotionBindings)}
          expressionOptions={expressionOptions}
          onUpdate={updateEmotionBinding}
        />
      </Accordion>

      <Accordion
        title="話者設置"
        open={openSections.speaker}
        onToggle={() => setOpenSections((prev) => ({ ...prev, speaker: !prev.speaker }))}
        badge={
          <span className="text-[10px] font-normal text-[var(--ui-text-secondary)]">
            感情ごとに音声を切り替えたい場合はここから設定します
          </span>
        }
      >
        <EmotionSpeakerSection
          bindings={normalizeEmotionBindings(form.emotionBindings)}
          speakers={speakers}
          onUpdate={updateEmotionBinding}
        />
      </Accordion>

      <Accordion
        title="ポーズ"
        open={openSections.pose}
        onToggle={() => setOpenSections((prev) => ({ ...prev, pose: !prev.pose }))}
      >
        <PoseAssignmentsSection
          poseFormOpen={poseFormOpen}
          saving={saving}
          poseSectionDisabled={poseSectionDisabled}
          previewSource={previewSource}
          availablePoses={availablePoses}
          poseGroups={poseGroups}
          groupNameRefs={groupNameRefs}
          onPoseFormOpenChange={setPoseFormOpen}
          onRegisterPose={registerPose}
          onRenamePoseGroup={renamePoseGroup}
          onChangeAttachmentPoseId={changeAttachmentPoseId}
          onRemoveAttachmentAt={removeAttachmentAt}
          onAddVariationToGroup={addVariationToGroup}
          onAddPoseGroup={addPoseGroup}
          poseLabel={poseLabel}
        />
      </Accordion>

      {confirmDeleteOpen ? (
        <ConfirmDeleteDialog
          label={form.name || vrmFileName || modelId || ''}
          deleting={deleting}
          deleteError={deleteError}
          onCancel={() => setConfirmDeleteOpen(false)}
          onDelete={() => void handleDelete()}
        />
      ) : null}
    </div>
  )
}
