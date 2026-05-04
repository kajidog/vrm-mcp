import type { App } from '@modelcontextprotocol/ext-apps'
import { useApp } from '@modelcontextprotocol/ext-apps/react'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useEffect, useRef, useState } from 'react'
import type { VrmPayload, VrmPlayerState, VrmPlayerStatus } from '../types'
import {
  type PoseSegment,
  extractPayloadFromInput,
  extractPayloadFromResult,
  extractPoseSegmentsFromResult,
} from '../utils/vrmPayload'
import { resolveVrmSource } from '../utils/vrmSource'
import { useRevokableObjectUrl } from './useRevokableObjectUrl'
import { fetchDefaultVrmOnServer, fetchVrmModelOnServer, resynthesizeSegmentOnServer } from './vrmPlayerToolClient'

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
  const [pose, setPose] = useState<string | undefined>(undefined)
  const [segments, setSegments] = useState<PoseSegment[]>([])
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState<number | null>(null)
  const [activeModel, setActiveModel] = useState<{ id: string; name: string; speakerId: number } | null>(null)
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
  const { replaceObjectUrl } = useRevokableObjectUrl()

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
      setPose('idle')
      return
    }

    playbackIndexRef.current = index
    setCurrentSegmentIndex(index)
    setPose(current.pose ?? 'idle')

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
      void audio.play().catch(() => {
        if (version !== playbackVersionRef.current) return
        schedulePoseTimer(index, version, estimateSegmentDurationMs(current))
      })
    } else {
      schedulePoseTimer(index, version, estimateSegmentDurationMs(current))
    }
  }

  // 新しいセグメント列で再生を開始する。差し替えのたびに version を進めて古い callback を打ち切る。
  const startPlayback = (next: PoseSegment[]) => {
    stopPlayback()
    segmentsRef.current = next
    setSegments(next)
    playbackVersionRef.current += 1
    if (next.length === 0) {
      playbackIndexRef.current = 0
      setCurrentSegmentIndex(null)
      setPose(undefined)
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
    audioRef.current = new Audio()
    return () => {
      stopPlayback()
      audioRef.current = null
    }
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
    setErrorMsg('')
  }

  // サーバの `_resolve_default_vrm_for_player` を叩いてフォールバック表示を試みる。
  // - デフォルトが未設定（source: 'none'）→ 空表示
  // - デフォルトはあるが解決失敗 → エラー表示（reason をメッセージに含める）
  const applyDefaultPayload = async (reason: string): Promise<void> => {
    const currentApp = appRef.current
    if (!currentApp) return

    try {
      const defaultPayload = await fetchDefaultVrmOnServer(currentApp)
      if (!defaultPayload) {
        clearToEmpty()
        return
      }

      const {
        source: defaultSource,
        error,
        revokeUrl,
      } = await resolveVrmSource(currentApp, defaultPayload, { isDefault: true })
      replaceObjectUrl(revokeUrl ?? null)

      if (!defaultSource || error) {
        setResolvedSource(null)
        setStatus('error')
        setErrorMsg(error ?? `${reason}。デフォルト VRM も取得できませんでした。`)
        return
      }

      setResolvedSource(defaultSource)
      setStatus('ready')
      setErrorMsg('')
    } catch (error) {
      setResolvedSource(null)
      setStatus('error')
      setErrorMsg(`${reason}。デフォルト VRM も取得できませんでした: ${String(error)}`)
    }
  }

  // ツール入力 / 結果のペイロードを表示用に解決する。
  // `fallbackStatus='ready'` のとき（=ツール結果）にだけデフォルト VRM へフォールバックする。
  // 入力通知の段階（'waiting'）では「結果待ち」を維持し、勝手に default を出さない。
  const applyPayload = async (payload: VrmPayload | null, fallbackStatus: SettledStatus) => {
    const currentApp = appRef.current
    if (!currentApp) return

    setLoadingModel(true)
    try {
      const { source: nextSource, error, revokeUrl } = await resolveVrmSource(currentApp, payload)
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
        setStatus('waiting')
        await applyPayload(extractPayloadFromInput(params), 'waiting')
      }

      // ツール結果到着。エラーなら即エラー表示、それ以外はペイロードを解決する。
      createdApp.ontoolresult = async (result: CallToolResult) => {
        if (result.isError) {
          stopPlayback()
          setSegments([])
          setCurrentSegmentIndex(null)
          setPose(undefined)
          setStatus('error')
          setErrorMsg(extractErrorMessage(result))
          return
        }

        const payload = extractPayloadFromResult(result)
        if (!payload && !isPlayerToolResult(result)) {
          return
        }

        // 結果に含まれる vrmModel から表示中モデル情報を更新する（モデル切替時の話者解決に使う）。
        const structured = result.structuredContent as Record<string, unknown> | undefined
        if (structured && typeof structured === 'object' && 'vrmModel' in structured) {
          const vm = structured.vrmModel as Record<string, unknown> | undefined
          if (vm && typeof vm.id === 'string' && typeof vm.name === 'string' && typeof vm.speakerId === 'number') {
            setActiveModel({ id: vm.id, name: vm.name, speakerId: vm.speakerId })
          }
        }

        // speak_player の新形式は segments[].pose と audioBase64 を含む。
        // 音声付きセグメントがあれば onended 駆動で順次再生する。
        const nextSegments = extractPoseSegmentsFromResult(result)
        if (nextSegments) {
          startPlayback(nextSegments)
        } else if (isPlayerToolResult(result)) {
          stopPlayback()
          setSegments([])
          setCurrentSegmentIndex(null)
          setPose(undefined)
        }

        await applyPayload(payload, 'ready')
      }

      createdApp.ontoolcancelled = () => {
        setStatus('waiting')
      }

      createdApp.onteardown = async () => {
        replaceObjectUrl(null)
        return {}
      }

      createdApp.onerror = (err: unknown) => {
        console.error('[VRM Player] Error:', err)
        setStatus('error')
        setErrorMsg(String(err))
      }
    },
  })

  // App ハンドルが確立した直後は「ツール入力待ち」へ遷移させる。
  useEffect(() => {
    if (app) setStatus('waiting')
  }, [app])

  useEffect(() => {
    if (!appError) return
    setStatus('error')
    setErrorMsg(`Connection error: ${appError.message}`)
  }, [appError])

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
    try {
      startPlayback(await resynthesizeSegments(currentApp, model.speakerId, existing))
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
      const { metadata, vrmUrl } = await fetchVrmModelOnServer(currentApp, modelId)
      const {
        source: nextSource,
        error,
        revokeUrl,
      } = await resolveVrmSource(currentApp, { vrmUrl }, { isDefault: false })
      replaceObjectUrl(revokeUrl ?? null)

      if (error || !nextSource) {
        setStatus('error')
        setErrorMsg(error ?? 'VRM の取得に失敗しました')
        return
      }

      // 表示中ラベルを「登録名」で上書き（vrmUrl だと UUID しか出ないため）。
      setResolvedSource({ ...nextSource, label: metadata.name, note: 'モデルを切替えました' })
      setActiveModel({ id: metadata.id, name: metadata.name, speakerId: metadata.speakerId })
      setStatus('ready')
      setErrorMsg('')

      const existing = segmentsRef.current
      if (existing.length > 0) {
        startPlayback(await resynthesizeSegments(currentApp, metadata.speakerId, existing))
      }
    } catch (e) {
      setStatus('error')
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
    pose,
    segments,
    currentSegmentIndex,
    currentSegmentText: currentSegmentIndex !== null ? (segments[currentSegmentIndex]?.text ?? null) : null,
    activeModel,
    isPlaying: currentSegmentIndex !== null && !paused,
    canReplay: currentSegmentIndex === null && segments.length > 0,
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
        setErrorMsg(message)
        return
      }

      setLoadingModel(true)
      void applyDefaultPayload(message).finally(() => setLoadingModel(false))
    },
  }
}
