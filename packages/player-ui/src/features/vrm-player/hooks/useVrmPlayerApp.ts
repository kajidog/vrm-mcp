import type { App } from '@modelcontextprotocol/ext-apps'
import { useApp } from '@modelcontextprotocol/ext-apps/react'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePoseRegistry } from '~/features/poses/hooks/usePoseRegistry'
import { resolveSegmentPose } from '~/features/poses/resolve'
import type { ModelPoseAttachment, PoseSource } from '~/features/poses/types'
import type { VrmPayload, VrmPlayerState, VrmPlayerStatus } from '../types'
import {
  type PoseSegment,
  extractModelIdFromInput,
  extractPayloadFromInput,
  extractPayloadFromResult,
  extractPoseSegmentsFromResult,
} from '../utils/vrmPayload'
import { resolveVrmSource } from '../utils/vrmSource'
import { useLipSync } from './useLipSync'
import { useRevokableObjectUrl } from './useRevokableObjectUrl'
import {
  fetchDefaultVrmOnServer,
  fetchSegmentsAudioOnServer,
  fetchSpeakerIconOnServer,
  fetchVrmModelOnServer,
  resynthesizeSegmentOnServer,
} from './vrmPlayerToolClient'

// `connecting` を除く「落ち着いた」表示状態。`applyPayload` の fallback に使う。
type SettledStatus = Exclude<VrmPlayerStatus, 'connecting'>

// CallToolResult の text コンテンツをエラーメッセージとして取り出す。
function extractErrorMessage(result: CallToolResult): string {
  const text = result.content?.find((content) => content.type === 'text')
  return text?.type === 'text' ? text.text : 'Unknown error'
}

function isPlayerToolResult(result: CallToolResult): boolean {
  const structured = result.structuredContent as Record<string, unknown> | undefined
  const meta = (result as { _meta?: Record<string, unknown> })._meta
  return Boolean(
    structured?.viewUUID ||
      structured?.segments ||
      structured?.vrmBase64 ||
      structured?.vrmResourceUri ||
      structured?.vrmModel ||
      meta?.viewUUID ||
      meta?.segments ||
      meta?.vrmBase64 ||
      meta?.vrmResourceUri ||
      meta?.vrmModel
  )
}

// 音声合成に失敗したセグメントは audioBase64 が無いので、テキスト長から再生時間を推定する。
function estimateSegmentDurationMs(segment: PoseSegment): number {
  const charDurationMs = 130
  const speed = segment.speedScale && segment.speedScale > 0 ? segment.speedScale : 1
  const base = Math.max(segment.text.length, 1) * charDurationMs
  return Math.max(600, Math.round(base / speed))
}

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }))
}

const PLAYED_KEY_PREFIX = 'vrm-played-'
const PLAYED_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000

function readDataUrl(record: Record<string, unknown>): string | undefined {
  if (typeof record.thumbnailUrl === 'string' && record.thumbnailUrl.trim()) return record.thumbnailUrl
  if (typeof record.thumbnailBase64 !== 'string' || !record.thumbnailBase64.trim()) return undefined
  const mimeType =
    typeof record.thumbnailMimeType === 'string' && record.thumbnailMimeType.trim()
      ? record.thumbnailMimeType
      : 'image/png'
  return `data:${mimeType};base64,${record.thumbnailBase64}`
}

function readToolMeta(result: CallToolResult): Record<string, unknown> {
  const structured = result.structuredContent
  const meta = (result as { _meta?: Record<string, unknown> })._meta
  return {
    ...(structured && typeof structured === 'object' ? (structured as Record<string, unknown>) : {}),
    ...(meta && typeof meta === 'object' ? meta : {}),
  }
}

function readModelPoses(value: unknown): ModelPoseAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const poses = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    if (typeof record.id === 'string' && typeof record.name === 'string') {
      return [{ poseId: record.id, name: record.name }]
    }
    if (typeof record.poseId === 'string' && typeof record.name === 'string') {
      return [{ poseId: record.poseId, name: record.name }]
    }
    return []
  })

  return poses.length > 0 ? poses : undefined
}

function consumeAutoPlay(meta: Record<string, unknown>): boolean {
  const wantedAutoPlay = meta.autoPlay !== false
  const viewUUID = typeof meta.viewUUID === 'string' && meta.viewUUID.trim() ? meta.viewUUID : undefined
  if (!viewUUID) return wantedAutoPlay

  try {
    const key = `${PLAYED_KEY_PREFIX}${viewUUID}`
    const restored = localStorage.getItem(key) !== null
    if (!restored) {
      localStorage.setItem(key, JSON.stringify({ playedAt: Date.now() }))
    }
    return wantedAutoPlay && !restored
  } catch {
    return wantedAutoPlay
  }
}

function cleanupPlayedKeys(): void {
  try {
    const now = Date.now()
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(PLAYED_KEY_PREFIX)) continue
      const raw = localStorage.getItem(key)
      let playedAt = 0
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { playedAt?: unknown }
          playedAt = typeof parsed.playedAt === 'number' ? parsed.playedAt : 0
        } catch {
          playedAt = 0
        }
      }
      if (!playedAt || now - playedAt > PLAYED_KEY_TTL_MS) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    // localStorage が使えない環境では何もしない。
  }
}

/**
 * MCP App としての接続を確立し、ツール入出力に応じて VRM の表示状態を管理する。
 *
 * 状態フロー:
 *   connecting → (App 確立) → waiting
 *   waiting    → (ontoolinput)  → applyPayload(input, 'waiting')
 *              → (ontoolresult) → applyPayload(result, 'ready')
 *   いずれかが解決失敗 → デフォルト VRM へフォールバック
 *   デフォルトも未設定 → 空表示（status='ready', source=null）
 */
export function useVrmPlayerApp(): VrmPlayerState {
  const [status, setStatus] = useState<VrmPlayerStatus>('connecting')
  const [errorMsg, setErrorMsg] = useState('')
  const [source, setSource] = useState<VrmPlayerState['source']>(null)
  const [loadingModel, setLoadingModel] = useState(false)
  const [loadingPhase, setLoadingPhase] = useState<VrmPlayerState['loadingPhase']>('idle')
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [pose, setPose] = useState<PoseSource | null>(null)
  const [segments, setSegments] = useState<PoseSegment[]>([])
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState<number | null>(null)
  const [activeModel, setActiveModel] = useState<VrmPlayerState['activeModel']>(null)
  const [speakerIconUrl, setSpeakerIconUrl] = useState<string | undefined>(undefined)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [paused, setPaused] = useState(false)
  const appRef = useRef<App | null>(null)
  // `setModelError` から「現在表示中のソース種別」を同期参照するための ref。
  const sourceRef = useRef<VrmPlayerState['source']>(null)
  const poseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const poseTimerStartedAtRef = useRef<number | null>(null)
  const poseTimerDurationRef = useRef<number | null>(null)
  const poseTimerRemainingRef = useRef<number | null>(null)
  const poseTimerIndexRef = useRef<number | null>(null)
  const poseTimerVersionRef = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  // 再生中のセグメント列へ同期参照。switchVrm が完了したあと「直近のセグメント列」で
  // 再合成を回したいので、setState とは別に ref を持つ。
  const segmentsRef = useRef<PoseSegment[]>([])
  // 現在再生しているセグメントのインデックス。onended 駆動で進める。
  const playbackIndexRef = useRef(0)
  // 「再生対象として設定されたセグメント列」を識別するためのバージョン番号。
  // モデル切替などで再生中に列が差し替わった場合、古い onended を無視するために使う。
  const playbackVersionRef = useRef(0)
  const speakerIconRequestRef = useRef(0)
  const activeModelRef = useRef<VrmPlayerState['activeModel']>(null)
  const poseLibraryRef = useRef<Map<string, PoseSource>>(new Map())
  // リップシンク制御。AudioContext は audio 生成の useEffect で attach し、
  // セグメント切替で setSegment を呼ぶ。mouthRef を VrmPlayerState に流して VRMScene で参照する。
  const lipSync = useLipSync()
  // ホストからツール入力 / 結果を一度でも受け取ったかどうか。
  // 受け取った後に初期デフォルトの非同期適用が遅れて返ってきても上書きしないためのガード。
  const toolInteractedRef = useRef(false)
  const { replaceObjectUrl } = useRevokableObjectUrl()

  const setResolvedActiveModel = (model: VrmPlayerState['activeModel']) => {
    activeModelRef.current = model
    setActiveModel(model)
  }

  const resolveCurrentPose = useCallback((poseName: string | undefined): PoseSource | null => {
    return resolveSegmentPose(poseName, activeModelRef.current?.poses, poseLibraryRef.current)
  }, [])

  const setLoadingState = useCallback((phase: VrmPlayerState['loadingPhase'], progress: number) => {
    setLoadingPhase(phase)
    setLoadingProgress(Math.min(100, Math.max(0, Math.round(progress))))
  }, [])

  // speak_player は音声バイナリを返さないので、viewUUID 経由で取り直して
  // index 整列でマージする。失敗した場合は audioBase64 なしで返し、推定時間で再生する。
  const mergeSegmentAudio = async (segments: PoseSegment[], viewUUID: string): Promise<PoseSegment[]> => {
    const currentApp = appRef.current
    if (!currentApp) return segments
    setLoadingState('preparingAudio', 65)
    try {
      const audio = await fetchSegmentsAudioOnServer(currentApp, viewUUID)
      setLoadingState('preparingAudio', 95)
      if (!audio) return segments
      const byIndex = new Map(audio.segments.map((entry) => [entry.index, entry]))
      return segments.map((segment, index) => {
        const entry = byIndex.get(index)
        if (!entry) return segment
        return {
          ...segment,
          audioBase64: entry.audioBase64 ?? segment.audioBase64,
          speedScale: entry.speedScale ?? segment.speedScale,
          audioQuery: entry.audioQuery ?? segment.audioQuery,
          prePhonemeLength: entry.prePhonemeLength ?? segment.prePhonemeLength,
          postPhonemeLength: entry.postPhonemeLength ?? segment.postPhonemeLength,
        }
      })
    } catch (error) {
      console.warn('[mergeSegmentAudio] fetch failed:', error)
      return segments
    }
  }

  const updateSpeakerIcon = async (speakerId: number | undefined): Promise<void> => {
    const requestId = speakerIconRequestRef.current + 1
    speakerIconRequestRef.current = requestId
    const currentApp = appRef.current
    if (!currentApp || speakerId === undefined) {
      setSpeakerIconUrl(undefined)
      return
    }
    try {
      const nextIconUrl = await fetchSpeakerIconOnServer(currentApp, speakerId)
      if (requestId === speakerIconRequestRef.current) setSpeakerIconUrl(nextIconUrl)
    } catch (error) {
      console.warn('[updateSpeakerIcon] speaker icon fetch failed:', error)
      if (requestId === speakerIconRequestRef.current) setSpeakerIconUrl(undefined)
    }
  }

  const clearPoseTimer = () => {
    if (poseTimerRef.current !== null) {
      clearTimeout(poseTimerRef.current)
      poseTimerRef.current = null
    }
    poseTimerStartedAtRef.current = null
    poseTimerDurationRef.current = null
    poseTimerIndexRef.current = null
    poseTimerVersionRef.current = null
  }

  const releaseAudioUrl = () => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
  }

  // 再生を完全に止める。新しい segment 列に差し替える前と unmount で必ず呼ぶ。
  const stopPlayback = () => {
    clearPoseTimer()
    poseTimerRemainingRef.current = null
    setPaused(false)
    const audio = audioRef.current
    if (audio) {
      audio.onended = null
      audio.onerror = null
      try {
        audio.pause()
      } catch {
        // 既に再生していなくてもエラーにしない。
      }
      audio.removeAttribute('src')
      audio.load()
    }
    releaseAudioUrl()
    lipSync.setSegment(null)
    setCurrentTime(0)
    setDuration(0)
  }

  const schedulePoseTimer = (index: number, version: number, duration: number) => {
    clearPoseTimer()
    poseTimerStartedAtRef.current = Date.now()
    poseTimerDurationRef.current = duration
    poseTimerIndexRef.current = index
    poseTimerVersionRef.current = version
    poseTimerRemainingRef.current = null
    poseTimerRef.current = setTimeout(() => {
      if (version !== playbackVersionRef.current) return
      clearPoseTimer()
      playSegmentAt(index + 1, version)
    }, duration)
  }

  // 1 セグメントを実際に再生する。audioBase64 が無いセグメントは推定時間でスキップする。
  const playSegmentAt = (index: number, version: number): void => {
    if (version !== playbackVersionRef.current) return
    clearPoseTimer()
    poseTimerRemainingRef.current = null
    setPaused(false)
    const list = segmentsRef.current
    const current = list[index]
    if (!current) {
      playbackIndexRef.current = list.length
      setCurrentSegmentIndex(null)
      setPose(resolveCurrentPose('idle'))
      return
    }

    playbackIndexRef.current = index
    setCurrentSegmentIndex(index)
    setCurrentTime(0)
    setDuration(0)
    setPose(resolveCurrentPose(current.pose ?? 'idle'))

    const audio = audioRef.current
    releaseAudioUrl()

    if (current.audioBase64 && audio) {
      const url = base64ToBlobUrl(current.audioBase64, 'audio/wav')
      audioUrlRef.current = url
      audio.src = url
      audio.onended = () => {
        if (version !== playbackVersionRef.current) return
        playSegmentAt(index + 1, version)
      }
      audio.onerror = () => {
        if (version !== playbackVersionRef.current) return
        // 再生失敗したら推定時間で次に進む。
        schedulePoseTimer(index, version, estimateSegmentDurationMs(current))
      }
      lipSync.setSegment(current)
      lipSync.resumeContext()
      void audio.play().catch(() => {
        if (version !== playbackVersionRef.current) return
        schedulePoseTimer(index, version, estimateSegmentDurationMs(current))
      })
    } else {
      lipSync.setSegment(null)
      schedulePoseTimer(index, version, estimateSegmentDurationMs(current))
    }
  }

  // 新しいセグメント列で再生を開始する。差し替えのたびに version を進めて古い callback を打ち切る。
  const startPlayback = (next: PoseSegment[], options: { autoPlay?: boolean } = {}) => {
    stopPlayback()
    segmentsRef.current = next
    setSegments(next)
    playbackVersionRef.current += 1
    if (next.length === 0) {
      playbackIndexRef.current = 0
      setCurrentSegmentIndex(null)
      setPose(null)
      return
    }
    if (options.autoPlay === false) {
      playbackIndexRef.current = 0
      setCurrentSegmentIndex(null)
      setPose(resolveCurrentPose('idle'))
      return
    }
    playSegmentAt(0, playbackVersionRef.current)
  }

  const play = () => {
    const list = segmentsRef.current
    if (list.length === 0) return

    if (paused) {
      setPaused(false)
      const audio = audioRef.current
      if (audio?.src && audio.paused && currentSegmentIndex !== null && poseTimerRemainingRef.current === null) {
        lipSync.setSegment(list[currentSegmentIndex] ?? null)
        lipSync.resumeContext()
        void audio.play().catch(() => {
          schedulePoseTimer(
            currentSegmentIndex,
            playbackVersionRef.current,
            estimateSegmentDurationMs(list[currentSegmentIndex])
          )
        })
        return
      }

      if (
        poseTimerRemainingRef.current !== null &&
        poseTimerIndexRef.current !== null &&
        poseTimerVersionRef.current === playbackVersionRef.current
      ) {
        schedulePoseTimer(poseTimerIndexRef.current, playbackVersionRef.current, poseTimerRemainingRef.current)
        return
      }
    }

    if (currentSegmentIndex === null) {
      startPlayback(list)
    }
  }

  const pause = () => {
    if (currentSegmentIndex === null || paused) return
    const audio = audioRef.current
    if (audio?.src && !audio.paused) {
      audio.pause()
      lipSync.setSegment(null)
      setPaused(true)
      return
    }

    if (
      poseTimerRef.current !== null &&
      poseTimerStartedAtRef.current !== null &&
      poseTimerDurationRef.current !== null
    ) {
      const elapsed = Date.now() - poseTimerStartedAtRef.current
      poseTimerRemainingRef.current = Math.max(0, poseTimerDurationRef.current - elapsed)
      clearTimeout(poseTimerRef.current)
      poseTimerRef.current = null
      poseTimerStartedAtRef.current = null
      poseTimerDurationRef.current = null
      lipSync.setSegment(null)
      setPaused(true)
    }
  }

  const jumpTo = (index: number) => {
    const list = segmentsRef.current
    if (list.length === 0) return
    stopPlayback()
    playbackVersionRef.current += 1
    segmentsRef.current = list
    setSegments(list)
    playSegmentAt(Math.min(Math.max(index, 0), list.length - 1), playbackVersionRef.current)
  }

  const prev = () => {
    const current = currentSegmentIndex ?? playbackIndexRef.current
    jumpTo(current - 1)
  }

  const next = () => {
    const current = currentSegmentIndex ?? -1
    jumpTo(current + 1)
  }

  // <audio> 要素は React の制御外で使う（ライフサイクルだけ管理）。
  // stopPlayback は ref ベースで closure を捕まえないので、依存配列は空で問題ない。
  // biome-ignore lint/correctness/useExhaustiveDependencies: stopPlayback uses refs only and is stable across renders
  useEffect(() => {
    const audio = new Audio()
    const updateTime = () => setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0)
    const updateDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    audio.addEventListener('timeupdate', updateTime)
    audio.addEventListener('loadedmetadata', updateDuration)
    audioRef.current = audio
    lipSync.attachAudio(audio)
    return () => {
      stopPlayback()
      audio.removeEventListener('timeupdate', updateTime)
      audio.removeEventListener('loadedmetadata', updateDuration)
      audioRef.current = null
      lipSync.dispose()
    }
  }, [])

  useEffect(() => {
    cleanupPlayedKeys()
  }, [])

  const setResolvedSource = (nextSource: VrmPlayerState['source']) => {
    sourceRef.current = nextSource
    setSource(nextSource)
  }

  // 表示を「空」に確定させる。デフォルト未設定や明示クリア時に使う。
  const clearToEmpty = () => {
    replaceObjectUrl(null)
    setResolvedSource(null)
    setStatus('ready')
    setLoadingState('ready', 100)
    setErrorMsg('')
  }

  // サーバの `_resolve_default_vrm_for_player` を叩いてフォールバック表示を試みる。
  // - デフォルトが未設定（source: 'none'）→ 空表示
  // - デフォルトはあるが解決失敗 → エラー表示（reason をメッセージに含める）
  // `shouldAbort` は await 境界ごとにチェックされ、true を返したら以降の setState を行わずに早期 return する。
  // これは「初期プリロード中にツール入力が割り込んできた場合」に古い結果でツールの状態を上書きしないために使う。
  const applyDefaultPayload = async (reason: string, shouldAbort: () => boolean = () => false): Promise<void> => {
    const currentApp = appRef.current
    if (!currentApp) return

    try {
      setLoadingState('resolvingModel', 25)
      const resolved = await fetchDefaultVrmOnServer(currentApp)
      if (shouldAbort()) return
      if (!resolved) {
        clearToEmpty()
        return
      }

      const {
        source: defaultSource,
        error,
        revokeUrl,
      } = await resolveVrmSource(currentApp, resolved.payload, { isDefault: true })
      setLoadingState('loadingVrm', 45)
      if (shouldAbort()) {
        // 既に別系統の payload で表示が進んでいる時は、ここで作った Object URL は捨てる。
        if (revokeUrl) URL.revokeObjectURL(revokeUrl)
        return
      }
      replaceObjectUrl(revokeUrl ?? null)

      if (!defaultSource || error) {
        setResolvedSource(null)
        setStatus('error')
        setLoadingState('error', 100)
        setErrorMsg(error ?? `${reason}。デフォルト VRM も取得できませんでした。`)
        return
      }

      setResolvedSource(defaultSource)
      // registry 経由のデフォルトには metadata があるので、active モデル表示と話者アイコンも合わせて反映する。
      // config 由来のフォールバックでは metadata なしなので、active モデルは未設定のまま。
      if (resolved.metadata) {
        const meta = resolved.metadata
        setResolvedActiveModel({
          id: meta.id,
          name: meta.name,
          speakerId: meta.speakerId,
          poses: meta.poses,
          thumbnailUrl:
            meta.thumbnailBase64 !== undefined
              ? `data:${meta.thumbnailMimeType ?? 'image/png'};base64,${meta.thumbnailBase64}`
              : undefined,
        })
        void updateSpeakerIcon(meta.speakerId)
      }
      setStatus('ready')
      setLoadingState('ready', 100)
      setErrorMsg('')
    } catch (error) {
      if (shouldAbort()) return
      setResolvedSource(null)
      setStatus('error')
      setLoadingState('error', 100)
      setErrorMsg(`${reason}。デフォルト VRM も取得できませんでした: ${String(error)}`)
    }
  }

  const applyModelPreview = async (modelId: string | undefined): Promise<void> => {
    const currentApp = appRef.current
    if (!currentApp) return
    setLoadingState('resolvingModel', 25)
    if (modelId) {
      const { metadata, vrmUrl } = await fetchVrmModelOnServer(currentApp, modelId)
      setResolvedActiveModel({
        id: metadata.id,
        name: metadata.name,
        speakerId: metadata.speakerId,
        poses: metadata.poses,
        thumbnailUrl:
          metadata.thumbnailBase64 !== undefined
            ? `data:${metadata.thumbnailMimeType ?? 'image/png'};base64,${metadata.thumbnailBase64}`
            : undefined,
      })
      void updateSpeakerIcon(metadata.speakerId)
      const {
        source: nextSource,
        error,
        revokeUrl,
      } = await resolveVrmSource(currentApp, { vrmUrl }, { isDefault: false })
      replaceObjectUrl(revokeUrl ?? null)
      setLoadingState('loadingVrm', 45)
      if (error || !nextSource) {
        setStatus('error')
        setLoadingState('error', 100)
        setErrorMsg(error ?? 'VRM の取得に失敗しました')
        return
      }
      setResolvedSource({ ...nextSource, label: metadata.name })
      setErrorMsg('')
      return
    }

    await applyDefaultPayload('ツール入力のデフォルト VRM 解決')
  }

  // ツール入力 / 結果のペイロードを表示用に解決する。
  // `fallbackStatus='ready'` のとき（=ツール結果）にだけデフォルト VRM へフォールバックする。
  // 入力通知の段階（'waiting'）では結果待ちを維持する。modelId 未指定時の default 解決は
  // `applyModelPreview` 側で先読みとして行う。
  const applyPayload = async (payload: VrmPayload | null, fallbackStatus: SettledStatus) => {
    const currentApp = appRef.current
    if (!currentApp) return

    setLoadingModel(true)
    try {
      setLoadingState('resolvingModel', 25)
      const { source: nextSource, error, revokeUrl } = await resolveVrmSource(currentApp, payload)
      setLoadingState('loadingVrm', 45)
      replaceObjectUrl(revokeUrl ?? null)

      if (error) {
        await applyDefaultPayload(error)
        return
      }

      if (!nextSource && fallbackStatus === 'ready') {
        await applyDefaultPayload('VRM データが tool result に含まれていません')
        return
      }

      setResolvedSource(nextSource)
      setStatus(nextSource ? 'ready' : fallbackStatus)
      if (nextSource) setLoadingState('loadingVrm', 55)
      else setLoadingState(fallbackStatus === 'ready' ? 'ready' : 'waitingTool', fallbackStatus === 'ready' ? 100 : 20)
      setErrorMsg('')
    } catch (error) {
      await applyDefaultPayload(`VRM の取得に失敗しました: ${String(error)}`)
    } finally {
      setLoadingModel(false)
    }
  }

  const { app, error: appError } = useApp({
    appInfo: { name: 'VRM Player', version: '1.0.0' },
    capabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    onAppCreated: (createdApp: App) => {
      appRef.current = createdApp

      // ホストがツールを呼び始めた段階。引数から先行プレビューできるか試す。
      createdApp.ontoolinput = async (params) => {
        toolInteractedRef.current = true
        setStatus('waiting')
        setLoadingModel(true)
        setLoadingState('waitingTool', 10)
        try {
          const inputPayload = extractPayloadFromInput(params)
          if (inputPayload) await applyPayload(inputPayload, 'waiting')
          else await applyModelPreview(extractModelIdFromInput(params))
          setLoadingState('waitingTool', 20)
        } catch (error) {
          setStatus('error')
          setLoadingState('error', 100)
          setErrorMsg(`ツール入力のモデル解決に失敗しました: ${String(error)}`)
        } finally {
          setLoadingModel(false)
        }
      }

      // ツール結果到着。エラーなら即エラー表示、それ以外はペイロードを解決する。
      createdApp.ontoolresult = async (result: CallToolResult) => {
        toolInteractedRef.current = true
        if (result.isError) {
          stopPlayback()
          setSegments([])
          setCurrentSegmentIndex(null)
          setPose(null)
          setStatus('error')
          setLoadingState('error', 100)
          setErrorMsg(extractErrorMessage(result))
          return
        }

        const payload = extractPayloadFromResult(result)
        if (!payload && !isPlayerToolResult(result)) {
          return
        }

        setLoadingModel(true)
        setLoadingState('resolvingModel', 25)
        try {
          // 結果に含まれる vrmModel から表示中モデル情報を更新する（モデル切替時の話者解決に使う）。
          const meta = readToolMeta(result)
          const structured = result.structuredContent as Record<string, unknown> | undefined
          let hasVrmModel = false
          if (structured && typeof structured === 'object' && 'vrmModel' in structured) {
            const vm = structured.vrmModel as Record<string, unknown> | undefined
            if (vm && typeof vm.id === 'string' && typeof vm.name === 'string' && typeof vm.speakerId === 'number') {
              hasVrmModel = true
              setResolvedActiveModel({
                id: vm.id,
                name: vm.name,
                speakerId: vm.speakerId,
                poses: readModelPoses(vm.poses),
                thumbnailUrl: readDataUrl(vm),
              })
            }
          }

          await applyPayload(payload, 'ready')

          // speak_player の新形式は segments[].pose を含むがレスポンスサイズの都合で
          // 音声バイナリは含めない。viewUUID で `_get_player_audio_for_player` を後追い
          // 取得し、index 整列でマージしてから再生を始める。
          const nextSegments = extractPoseSegmentsFromResult(result)
          if (nextSegments) {
            if (!hasVrmModel) setResolvedActiveModel(null)
            const viewUUID = typeof meta.viewUUID === 'string' && meta.viewUUID.trim() ? meta.viewUUID : undefined
            const segmentsForPlayback = viewUUID ? await mergeSegmentAudio(nextSegments, viewUUID) : nextSegments
            startPlayback(segmentsForPlayback, { autoPlay: consumeAutoPlay(meta) })
            void updateSpeakerIcon(segmentsForPlayback[0]?.speaker)
            setLoadingState('ready', 100)
          } else if (isPlayerToolResult(result)) {
            stopPlayback()
            setSegments([])
            setCurrentSegmentIndex(null)
            setPose(null)
            setLoadingState('ready', 100)
          }
        } catch (error) {
          setStatus('error')
          setLoadingState('error', 100)
          setErrorMsg(`ツール結果の処理に失敗しました: ${String(error)}`)
        } finally {
          setLoadingModel(false)
        }
      }

      createdApp.ontoolcancelled = () => {
        setStatus('waiting')
        setLoadingState('waitingTool', 20)
      }

      createdApp.onteardown = async () => {
        replaceObjectUrl(null)
        return {}
      }

      createdApp.onerror = (err: unknown) => {
        console.error('[VRM Player] Error:', err)
        setStatus('error')
        setLoadingState('error', 100)
        setErrorMsg(String(err))
      }
    },
  })

  const { poseLibrary } = usePoseRegistry(app ?? null)

  useEffect(() => {
    poseLibraryRef.current = poseLibrary
    const currentSegment = currentSegmentIndex !== null ? segmentsRef.current[currentSegmentIndex] : null
    setPose(resolveCurrentPose(currentSegment?.pose ?? 'idle'))
  }, [poseLibrary, currentSegmentIndex, resolveCurrentPose])

  // App ハンドルが確立した直後は「ツール入力待ち」へ遷移させる。
  // 加えて、まだツール入出力が無いうちにデフォルト VRM をプリロードして
  // モデルピッカーに「現在のモデル」が見える状態を作る（指定なしで開かれた時のフォールバック）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: applyDefaultPayload は ref ベースのクロージャで安定
  useEffect(() => {
    if (!app) return
    setStatus('waiting')
    setLoadingState('waitingTool', 0)
    if (toolInteractedRef.current) return
    setLoadingModel(true)
    void applyDefaultPayload('プレイヤー初期化時のデフォルト VRM 読み込み', () => toolInteractedRef.current).finally(
      () => setLoadingModel(false)
    )
  }, [app])

  useEffect(() => {
    if (!appError) return
    setStatus('error')
    setLoadingState('error', 100)
    setErrorMsg(`Connection error: ${appError.message}`)
  }, [appError, setLoadingState])

  const resynthesizeSegments = async (
    currentApp: App,
    speakerId: number,
    list: PoseSegment[]
  ): Promise<PoseSegment[]> => {
    return Promise.all(
      list.map(async (segment) => {
        try {
          const result = await resynthesizeSegmentOnServer(currentApp, {
            speakerId,
            text: segment.text,
            speedScale: segment.explicitSpeedScale,
          })
          return {
            ...segment,
            audioBase64: result.audioBase64,
            speaker: speakerId,
            speedScale: result.speedScale ?? segment.speedScale,
            audioQuery: result.audioQuery ?? segment.audioQuery,
            prePhonemeLength: result.prePhonemeLength,
            postPhonemeLength: result.postPhonemeLength,
          }
        } catch (e) {
          console.warn('[resynthesizeSegments] resynthesize failed:', e)
          return { ...segment, audioBase64: undefined, speaker: speakerId }
        }
      })
    )
  }

  const resynthesizeAll = async (): Promise<void> => {
    const currentApp = appRef.current
    const model = activeModel
    const existing = segmentsRef.current
    if (!currentApp || !model || existing.length === 0) return

    setLoadingModel(true)
    setLoadingState('preparingAudio', 65)
    try {
      startPlayback(await resynthesizeSegments(currentApp, model.speakerId, existing))
      setLoadingState('ready', 100)
    } finally {
      setLoadingModel(false)
    }
  }

  // 登録済みモデルへ表示を切り替え、現在のセグメントを新 speaker で再合成して再生し直す。
  // - 表示中の VRM 自体は vrmUrl 経由で差し替える（ローカルパスは iframe で読めない）
  // - 既に segments があれば全件並列で再合成
  const switchVrm = async (modelId: string): Promise<void> => {
    const currentApp = appRef.current
    if (!currentApp) return

    setLoadingModel(true)
    try {
      setLoadingState('resolvingModel', 25)
      const { metadata, vrmUrl } = await fetchVrmModelOnServer(currentApp, modelId)
      const {
        source: nextSource,
        error,
        revokeUrl,
      } = await resolveVrmSource(currentApp, { vrmUrl }, { isDefault: false })
      setLoadingState('loadingVrm', 45)
      replaceObjectUrl(revokeUrl ?? null)

      if (error || !nextSource) {
        setStatus('error')
        setLoadingState('error', 100)
        setErrorMsg(error ?? 'VRM の取得に失敗しました')
        return
      }

      // 表示中ラベルを「登録名」で上書き（vrmUrl だと UUID しか出ないため）。
      setResolvedSource({ ...nextSource, label: metadata.name, note: 'モデルを切替えました' })
      setResolvedActiveModel({
        id: metadata.id,
        name: metadata.name,
        speakerId: metadata.speakerId,
        poses: metadata.poses,
        thumbnailUrl:
          metadata.thumbnailBase64 !== undefined
            ? `data:${metadata.thumbnailMimeType ?? 'image/png'};base64,${metadata.thumbnailBase64}`
            : undefined,
      })
      void updateSpeakerIcon(metadata.speakerId)
      setStatus('ready')
      setErrorMsg('')

      const existing = segmentsRef.current
      if (existing.length > 0) {
        setLoadingState('preparingAudio', 65)
        startPlayback(await resynthesizeSegments(currentApp, metadata.speakerId, existing))
      }
      setLoadingState('ready', 100)
    } catch (e) {
      setStatus('error')
      setLoadingState('error', 100)
      setErrorMsg(`モデル切替に失敗しました: ${String(e)}`)
    } finally {
      setLoadingModel(false)
    }
  }

  return {
    status,
    errorMsg,
    source,
    loadingModel,
    loadingPhase,
    loadingProgress,
    pose,
    segments,
    currentSegmentIndex,
    currentTime,
    duration,
    currentSegmentText: currentSegmentIndex !== null ? (segments[currentSegmentIndex]?.text ?? null) : null,
    speakerIconUrl,
    activeModel,
    isPlaying: currentSegmentIndex !== null && !paused,
    canReplay: currentSegmentIndex === null && segments.length > 0,
    hasSegments: segments.length > 0,
    isReadyForDisplay: Boolean(app),
    app: app ?? null,
    switchVrm,
    play,
    pause,
    prev,
    next,
    resynthesizeAll,
    // `<VRMScene>` 内のロードエラー通知。
    // 既に default 表示中なら再フォールバックせずエラー表示に切り替える
    // （無限フォールバックを防ぐため）。
    setModelError: (message: string) => {
      if (sourceRef.current?.isDefault) {
        setStatus('error')
        setLoadingState('error', 100)
        setErrorMsg(message)
        return
      }

      setLoadingModel(true)
      void applyDefaultPayload(message).finally(() => setLoadingModel(false))
    },
    notifyVrmLoadStart: () => {
      if (loadingPhase === 'ready') return
      setLoadingState('loadingVrm', Math.max(loadingProgress, 50))
    },
    notifyVrmLoaded: () => {
      if (loadingPhase === 'loadingVrm' || loadingPhase === 'resolvingModel' || loadingPhase === 'waitingTool') {
        setLoadingState('loadingVrm', 60)
      }
    },
    mouthRef: lipSync.mouthRef,
  }
}
