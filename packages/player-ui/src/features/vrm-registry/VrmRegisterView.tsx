import type { App } from '@modelcontextprotocol/ext-apps'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDownIcon, DeleteIcon, FullscreenExitIcon, FullscreenIcon } from '~/icons'
import type { AudioQuery } from '~/types'
import { EMOTION_NAMES, type EmotionBinding } from '../emotions'
import { PoseRegisterModal } from '../poses/PoseRegisterModal'
import { usePoseRegistry } from '../poses/hooks/usePoseRegistry'
import { DEFAULT_POSE_ID, POSE_PRESETS } from '../poses/presets'
import type { ModelPoseAttachment } from '../poses/types'
import { VRMCanvas } from '../vrm-player/components/VRMCanvas'
import { type LipSyncController, useLipSync } from '../vrm-player/hooks/useLipSync'
import { useVrmFileDrop } from '../vrm-player/hooks/useVrmFileDrop'
import type { VrmSource } from '../vrm-player/types'
import type { PoseSegment } from '../vrm-player/utils/vrmPayload'
import { useVrmRegistry } from './hooks/useVrmRegistry'
import type { VrmMetadata } from './types'

interface VrmRegisterViewProps {
  app: App
  modelId: string | null
  onBack: () => void
  onSaved: () => void
  fullscreen?: boolean
  canFullscreen?: boolean
  onToggleFullscreen?: () => void
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

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// 試聴用のサンプル文。短く中立な発話を 1 つランダムに選んで再生する。
const SAMPLE_PHRASES = [
  'こんにちは。',
  '今日もよろしくね。',
  'これはテスト音声です。',
  '準備はできた？',
  'うん、いい感じ。',
] as const

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

// 話者ポートレート（キャラクター画像）のフェッチ + uuid 単位のメモリキャッシュ。
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

// プレビュー試聴用。永続的な <audio> を 1 つだけ作って lipSync に attach し、
// 話者切替のたびに src だけ差し替える。リクエスト ID で古い合成結果を破棄する。
function useTestSpeakPlayer(app: App | null, lipSync: LipSyncController) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)
  const appRef = useRef(app)
  appRef.current = app

  useEffect(() => {
    const audio = new Audio()
    audioRef.current = audio
    lipSync.attachAudio(audio)
    return () => {
      requestIdRef.current += 1
      audio.onended = null
      audio.onerror = null
      try {
        audio.pause()
      } catch {
        // 既に停止していてもエラーにしない。
      }
      audio.removeAttribute('src')
      audio.load()
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
      audioRef.current = null
      lipSync.setSegment(null)
      lipSync.dispose()
    }
  }, [lipSync])

  return useCallback(
    async (speakerId: number) => {
      const currentApp = appRef.current
      const audio = audioRef.current
      if (!currentApp || !audio) return
      const requestId = ++requestIdRef.current
      const text = pickRandom(SAMPLE_PHRASES)
      try {
        const result = await currentApp.callServerTool({
          name: '_resynthesize_for_player',
          arguments: { speakerId, text },
        })
        if (requestId !== requestIdRef.current) return
        const parsed = parseToolJson<{
          audioBase64: string
          audioMimeType?: string
          audioQuery?: AudioQuery
          speedScale?: number
        }>(result)
        try {
          audio.pause()
        } catch {
          // ignore
        }
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current)
        }
        const url = base64ToBlobUrl(parsed.audioBase64, parsed.audioMimeType ?? 'audio/wav')
        blobUrlRef.current = url
        audio.src = url
        const segment: PoseSegment = {
          text,
          speaker: speakerId,
          audioQuery: parsed.audioQuery,
          speedScale: parsed.speedScale,
        }
        lipSync.setSegment(segment)
        lipSync.resumeContext()
        audio.onended = () => {
          if (requestId !== requestIdRef.current) return
          lipSync.setSegment(null)
        }
        audio.onerror = () => {
          if (requestId !== requestIdRef.current) return
          lipSync.setSegment(null)
        }
        try {
          await audio.play()
        } catch (error) {
          console.warn('[useTestSpeakPlayer] play failed:', error)
          lipSync.setSegment(null)
        }
      } catch (error) {
        console.warn('[useTestSpeakPlayer] synthesize failed:', error)
      }
    },
    [lipSync]
  )
}

// React の reconciliation で「ポーズ名」入力欄がリレンダ毎にアンマウントされないように、
// グループキーは attachment 単位で永続な _key を割り当てる。
interface FormAttachment extends ModelPoseAttachment {
  _key: string
}

interface FormState {
  name: string
  speakerId: number | null
  isDefault: boolean
  poses: FormAttachment[]
  emotionBindings: EmotionBinding[]
}

let attachmentKeyCounter = 0
const nextAttachmentKey = () => `att-${++attachmentKeyCounter}`

const INITIAL_FORM: FormState = {
  name: '',
  speakerId: null,
  isDefault: false,
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

interface AccordionProps {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  badge?: React.ReactNode
}

function Accordion({ title, open, onToggle, children, badge }: AccordionProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[var(--ui-tag-bg)]"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-[var(--ui-text)]">
          {title}
          {badge}
        </span>
        <span
          className={`flex h-5 w-5 items-center justify-center text-[var(--ui-text-secondary)] transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        >
          <ChevronDownIcon />
        </span>
      </button>
      {open ? <div className="border-t border-[var(--ui-border)] p-3">{children}</div> : null}
    </div>
  )
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
      const persistedPoses = stripAttachmentKeys(form.poses)
      const persistedEmotionBindings = form.emotionBindings.map((binding) => ({
        emotion: binding.emotion,
        ...(binding.expressionName?.trim() ? { expressionName: binding.expressionName.trim() } : {}),
        ...(binding.speakerId !== undefined ? { speakerId: binding.speakerId } : {}),
        ...(binding.weight !== undefined ? { weight: binding.weight } : {}),
      }))
      if (isEdit && modelId) {
        await update(modelId, {
          name: form.name.trim(),
          speakerId: form.speakerId,
          isDefault: form.isDefault,
          poses: persistedPoses,
          emotionBindings: persistedEmotionBindings,
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
          poses: persistedPoses,
          emotionBindings: persistedEmotionBindings,
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

  const previewControlsDisabled = previewSource === null

  return (
    <div
      className={`relative ${fullscreen ? 'flex min-h-full flex-col gap-2 p-2' : 'space-y-3 p-3'} ${
        dragHighlight ? 'outline-2 outline-offset-[-6px] outline-[var(--ui-accent)]' : ''
      }`}
      {...dropProps}
    >
      <input {...drop.inputProps} />

      <div className="sticky top-0 z-30 flex items-center justify-between gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2 shadow-sm">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
        >
          ← キャンセル
        </button>
        <div className="truncate text-sm font-semibold text-[var(--ui-text)]">
          {isEdit ? 'VRM を編集' : 'VRM を追加'}
        </div>
        <div className="flex items-center gap-1.5">
          {canFullscreen && onToggleFullscreen ? (
            <button
              type="button"
              title={fullscreen ? 'インライン表示' : '全画面'}
              onClick={onToggleFullscreen}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
            >
              {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </button>
          ) : null}
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

      <div
        className={`flex flex-col gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3 ${
          fullscreen ? 'h-[calc(100vh-5rem)] min-h-[420px] flex-none' : ''
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-[150px] flex-1 items-center gap-2 rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ui-text-secondary)]">
              表情
            </span>
            <select
              value={previewExpressionName ?? ''}
              onChange={(event) => setPreviewExpressionName(event.target.value || null)}
              disabled={previewControlsDisabled || availableExpressionNames.length === 0}
              className="min-w-0 flex-1 truncate rounded border-none bg-transparent text-xs text-[var(--ui-text)] focus:outline-none disabled:opacity-50"
            >
              <option value="">なし</option>
              {availableExpressionNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-[150px] flex-1 items-center gap-2 rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ui-text-secondary)]">
              ポーズ
            </span>
            <select
              value={previewPoseId}
              onChange={(event) => setPreviewPoseId(event.target.value)}
              disabled={previewControlsDisabled || availablePoses.length === 0}
              className="min-w-0 flex-1 truncate rounded border-none bg-transparent text-xs text-[var(--ui-text)] focus:outline-none disabled:opacity-50"
            >
              {availablePoses.map((pose) => (
                <option key={pose.id} value={pose.id}>
                  {poseLabel(pose.id)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ui-text-secondary)]">
              話者
            </span>
            <select
              value={previewSpeakerId ?? ''}
              onChange={(event) => {
                const next = event.target.value === '' ? null : Number(event.target.value)
                if (next !== null) handlePreviewSpeakerChange(next)
              }}
              disabled={previewControlsDisabled || speakersLoading || speakers.length === 0}
              className="min-w-0 flex-1 truncate rounded border-none bg-transparent text-xs text-[var(--ui-text)] focus:outline-none disabled:opacity-50"
            >
              <option value="" disabled>
                {speakersLoading ? '読み込み中...' : '選択'}
              </option>
              {speakers.map((s) => (
                <option key={`${s.uuid}-${s.id}`} value={s.id}>
                  {s.characterName}（{s.name}）
                </option>
              ))}
            </select>
          </label>
        </div>

        {previewError ? <div className="text-xs text-red-600">{previewError}</div> : null}

        {previewSource ? (
          <VRMCanvas
            source={previewSource}
            onError={setPreviewError}
            pose={previewPose}
            expression={previewExpression}
            mouthRef={lipSync.mouthRef}
            onExpressionsReady={setAvailableExpressionNames}
            speechText={null}
            fullscreen={fullscreen}
            heightClassName={fullscreen ? 'h-full' : 'h-[min(60vh,560px)] min-h-[360px]'}
          />
        ) : isEdit ? (
          <div className="flex h-[360px] items-center justify-center rounded-md border border-dashed border-[var(--ui-border)] text-center text-xs text-[var(--ui-text-secondary)]">
            既存 VRM のプレビューURLを取得しています。
          </div>
        ) : (
          <div className="flex h-[360px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--ui-border)] text-center text-xs text-[var(--ui-text-secondary)]">
            <div>VRM ファイルをドロップまたは選択するとプレビューできます。</div>
            <button
              type="button"
              onClick={() => drop.openFilePicker()}
              className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-3 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
            >
              ファイルを選択
            </button>
          </div>
        )}
      </div>

      <Accordion
        title="情報"
        open={openSections.info}
        onToggle={() => setOpenSections((prev) => ({ ...prev, info: !prev.info }))}
      >
        <div className="grid gap-3 md:grid-cols-2">
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
            <div className="mb-1 font-semibold text-[var(--ui-text)]">デフォルト話者</div>
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

          <label className="flex items-center gap-2 text-xs text-[var(--ui-text)] md:col-span-2">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm((prev) => ({ ...prev, isDefault: e.target.checked }))}
            />
            デフォルトに設定
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ui-text-secondary)] md:col-span-2">
            <div className="truncate">
              {vrmFileName ? (
                <>
                  <span className="font-semibold text-[var(--ui-text)]">{vrmFileName}</span>
                  <span className="ml-2">{formatBytes(vrmSize)}</span>
                </>
              ) : (
                'VRM ファイル未選択'
              )}
            </div>
            <button
              type="button"
              onClick={() => drop.openFilePicker()}
              className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
            >
              {isEdit ? 'モデルを変更' : 'ファイルを選択'}
            </button>
          </div>
        </div>
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
        <div className="space-y-2">
          <div className="text-[11px] text-[var(--ui-text-secondary)]">
            weight は表情の強度（0=適用しない / 1=最大）。VRM
            ロード時に表情名と感情名が一致した未設定行は自動補完されます。
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {normalizeEmotionBindings(form.emotionBindings).map((binding) => (
              <div
                key={binding.emotion}
                className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 rounded-md border border-[var(--ui-border)] bg-[var(--ui-bg)] p-2"
              >
                <div className="text-xs font-semibold text-[var(--ui-text)]">{binding.emotion}</div>
                <select
                  value={binding.expressionName ?? ''}
                  onChange={(event) =>
                    updateEmotionBinding(binding.emotion, {
                      expressionName: event.target.value || undefined,
                    })
                  }
                  className="min-w-0 rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1.5 text-xs text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
                >
                  <option value="">表情なし</option>
                  {expressionOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={binding.weight ?? 1}
                  onChange={(event) =>
                    updateEmotionBinding(binding.emotion, {
                      weight: Math.min(1, Math.max(0, Number(event.target.value))),
                    })
                  }
                  className="w-full rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1.5 text-xs text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
                />
              </div>
            ))}
          </div>
        </div>
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
        <div className="space-y-2">
          <div className="text-[11px] text-[var(--ui-text-secondary)]">未指定の感情はデフォルト話者を使います。</div>
          <div className="grid gap-2 lg:grid-cols-2">
            {normalizeEmotionBindings(form.emotionBindings).map((binding) => (
              <div
                key={binding.emotion}
                className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2 rounded-md border border-[var(--ui-border)] bg-[var(--ui-bg)] p-2"
              >
                <div className="text-xs font-semibold text-[var(--ui-text)]">{binding.emotion}</div>
                <select
                  value={binding.speakerId ?? ''}
                  onChange={(event) =>
                    updateEmotionBinding(binding.emotion, {
                      speakerId: event.target.value === '' ? undefined : Number(event.target.value),
                    })
                  }
                  className="min-w-0 rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1.5 text-xs text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
                >
                  <option value="">既定話者</option>
                  {speakers.map((s) => (
                    <option key={`${binding.emotion}-${s.uuid}-${s.id}`} value={s.id}>
                      {s.characterName}（{s.name}）
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      </Accordion>

      <Accordion
        title="ポーズ"
        open={openSections.pose}
        onToggle={() => setOpenSections((prev) => ({ ...prev, pose: !prev.pose }))}
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] leading-relaxed text-[var(--ui-text-secondary)]">
              MCP
              からポーズ名で呼び出します。同じポーズ名にバリエーションを複数登録すると、再生のたびに自動で切り替わります。
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
              <div className="space-y-2">
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
                      {group.items.map(({ attachment, index }) => (
                        <div
                          key={attachment._key}
                          className="grid h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2"
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
                            title="削除"
                            onClick={() => removeAttachmentAt(index)}
                            className="flex h-7 w-7 items-center justify-center rounded text-[var(--ui-danger)] hover:bg-[var(--ui-tag-bg)]"
                          >
                            <DeleteIcon />
                          </button>
                        </div>
                      ))}
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
      </Accordion>

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
