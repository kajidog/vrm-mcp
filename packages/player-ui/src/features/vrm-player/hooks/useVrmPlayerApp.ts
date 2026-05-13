import type { App } from '@modelcontextprotocol/ext-apps'
import { useApp } from '@modelcontextprotocol/ext-apps/react'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveEmotionBinding } from '~/features/emotions'
import { usePoseRegistry } from '~/features/poses/hooks/usePoseRegistry'
import { resolveSegmentPose } from '~/features/poses/resolve'
import type { PoseSource } from '~/features/poses/types'
import type { VrmPayload, VrmPlayerState, VrmPlayerStatus } from '../types'
import {
  cleanupPlayedKeys,
  consumeAutoPlay,
  extractErrorMessage,
  isPlayerToolResult,
  readDataUrl,
  readEmotionBindings,
  readModelManagerRequest,
  readModelPoses,
  readToolMeta,
} from '../utils/playerResult'
import {
  type PoseSegment,
  extractModelIdFromInput,
  extractPayloadFromInput,
  extractPayloadFromResult,
  extractPoseSegmentsFromResult,
} from '../utils/vrmPayload'
import { resolveVrmSource } from '../utils/vrmSource'
import { ensurePlayableSegments, mergeSegmentAudio, mergeSegmentAudioIndexes } from './segmentAudio'
import { useLipSync } from './useLipSync'
import { usePlayerLoadingState } from './usePlayerLoadingState'
import { useRenderSettings } from './useRenderSettings'
import { useRevokableObjectUrl } from './useRevokableObjectUrl'
import { useSegmentPlayback } from './useSegmentPlayback'
import {
  fetchDefaultVrmOnServer,
  fetchSpeakerIconOnServer,
  fetchVrmModelOnServer,
  resynthesizeSegmentOnServer,
  setPlayerSettingsOnServer,
} from './vrmPlayerToolClient'

// `connecting` を除く「落ち着いた」表示状態。payload が空だった時の表示維持に使う。
type SettledStatus = Exclude<VrmPlayerStatus, 'connecting'>

function isMissingPlayerSessionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('session not found')
}

/**
 * MCP App としての接続を確立し、ツール入出力に応じて VRM の表示状態を管理する。
 *
 * 状態フロー:
 *   connecting → (App 確立) → waiting
 *   waiting    → (ontoolinput)  → applyPayload(input, 'waiting')
 *              → (ontoolresult) → applyPayload(result, 'ready')
 *   初期表示 / modelId 未指定の入力通知 → デフォルト VRM を先読み
 *   いずれかが解決失敗 → エラー表示
 */
export function useVrmPlayerApp(): VrmPlayerState {
  const [status, setStatus] = useState<VrmPlayerStatus>('connecting')
  const [errorMsg, setErrorMsg] = useState('')
  const [source, setSource] = useState<VrmPlayerState['source']>(null)
  const [loadingModel, setLoadingModel] = useState(false)
  const { loadingPhase, loadingProgress, setLoadingState, notifyVrmLoadStart, notifyVrmLoaded } =
    usePlayerLoadingState()
  const [activeModel, setActiveModel] = useState<VrmPlayerState['activeModel']>(null)
  const [speakerIconUrl, setSpeakerIconUrl] = useState<string | undefined>(undefined)
  const [modelManagerRequest, setModelManagerRequest] = useState<VrmPlayerState['modelManagerRequest']>(null)
  const appRef = useRef<App | null>(null)
  // 非同期ハンドラから「現在表示中のソース有無」を同期参照するための ref。
  const sourceRef = useRef<VrmPlayerState['source']>(null)
  const speakerIconRequestRef = useRef(0)
  const activeModelRef = useRef<VrmPlayerState['activeModel']>(null)
  const poseLibraryRef = useRef<Map<string, PoseSource>>(new Map())
  const audioLoadRequestRef = useRef(0)
  // リップシンク制御。AudioContext は audio 生成の useEffect で attach し、
  // セグメント切替で setSegment を呼ぶ。mouthRef を VrmPlayerState に流して VRMScene で参照する。
  const lipSync = useLipSync()
  const { settings: renderSettings } = useRenderSettings()
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

  const resolveCurrentExpression = useCallback((segment: PoseSegment | null): VrmPlayerState['expression'] => {
    if (!segment) return null
    const expressionName =
      segment.expressionName ??
      resolveEmotionBinding(activeModelRef.current?.emotionBindings, segment.emotion)?.expressionName
    if (!expressionName) return null
    const weight =
      segment.expressionWeight ??
      resolveEmotionBinding(activeModelRef.current?.emotionBindings, segment.emotion)?.weight ??
      1
    return { name: expressionName, weight: Math.min(1, Math.max(0, weight)) }
  }, [])

  const setPlaybackError = useCallback(
    (message: string) => {
      setStatus('error')
      setLoadingState('error', 100)
      setErrorMsg(message)
    },
    [setLoadingState]
  )

  const playback = useSegmentPlayback({
    lipSync,
    resolvePose: resolveCurrentPose,
    resolveExpression: resolveCurrentExpression,
    onError: setPlaybackError,
  })

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

  const rememberActiveModel = (modelId: string): void => {
    const currentApp = appRef.current
    if (!currentApp) return
    void setPlayerSettingsOnServer(currentApp, { activeModelId: modelId }).catch((error) => {
      console.warn('[rememberActiveModel] failed to persist active model:', error)
    })
  }

  useEffect(() => {
    cleanupPlayedKeys()
  }, [])

  useEffect(() => {
    lipSync.setMoraTimingOffsetMs(renderSettings.moraTimingOffsetMs)
  }, [lipSync, renderSettings.moraTimingOffsetMs])

  const setResolvedSource = (nextSource: VrmPlayerState['source']) => {
    sourceRef.current = nextSource
    setSource(nextSource)
  }

  const inputHasSegments = (params: { arguments?: Record<string, unknown> }): boolean => {
    return Array.isArray(params.arguments?.segments)
  }

  // 表示を「空」に確定させる。デフォルト未設定や明示クリア時に使う。
  const clearToEmpty = () => {
    replaceObjectUrl(null)
    setResolvedSource(null)
    setStatus('ready')
    setLoadingState('ready', 100)
    setErrorMsg('')
  }

  // サーバの `_resolve_default_vrm_for_player` を叩いて初期 / 未指定モデル表示を試みる。
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
      // config 由来のデフォルトでは metadata なしなので、active モデルは未設定のまま。
      if (resolved.metadata) {
        const meta = resolved.metadata
        setResolvedActiveModel({
          id: meta.id,
          name: meta.name,
          speakerId: meta.speakerId,
          poses: meta.poses,
          emotionBindings: meta.emotionBindings,
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
      const { metadata, payload } = await fetchVrmModelOnServer(currentApp, modelId)
      setResolvedActiveModel({
        id: metadata.id,
        name: metadata.name,
        speakerId: metadata.speakerId,
        poses: metadata.poses,
        emotionBindings: metadata.emotionBindings,
        thumbnailUrl:
          metadata.thumbnailBase64 !== undefined
            ? `data:${metadata.thumbnailMimeType ?? 'image/png'};base64,${metadata.thumbnailBase64}`
            : undefined,
      })
      void updateSpeakerIcon(metadata.speakerId)
      const { source: nextSource, error, revokeUrl } = await resolveVrmSource(currentApp, payload, { isDefault: false })
      replaceObjectUrl(revokeUrl ?? null)
      setLoadingState('loadingVrm', 45)
      if (error || !nextSource) {
        setStatus('error')
        setLoadingState('error', 100)
        setErrorMsg(error ?? 'VRM の取得に失敗しました')
        return
      }
      setResolvedSource({ ...nextSource, label: metadata.name })
      rememberActiveModel(metadata.id)
      setErrorMsg('')
      return
    }

    await applyDefaultPayload('ツール入力のデフォルト VRM 解決')
  }

  // ツール入力 / 結果のペイロードを表示用に解決する。
  // 入力通知の段階（'waiting'）では結果待ちを維持する。modelId 未指定時の default 解決は
  // `applyModelPreview` 側で先読みとして行う。
  const applyPayload = async (payload: VrmPayload | null, settledStatus: SettledStatus) => {
    const currentApp = appRef.current
    if (!currentApp) return

    setLoadingModel(true)
    try {
      setLoadingState('resolvingModel', 25)
      const { source: nextSource, error, revokeUrl } = await resolveVrmSource(currentApp, payload)
      setLoadingState('loadingVrm', 45)
      replaceObjectUrl(revokeUrl ?? null)

      if (error) {
        setResolvedSource(null)
        setStatus('error')
        setLoadingState('error', 100)
        setErrorMsg(error)
        return
      }

      if (!nextSource && settledStatus === 'ready') {
        setStatus('error')
        setLoadingState('error', 100)
        setErrorMsg('VRM データが tool result に含まれていません。')
        return
      }

      setResolvedSource(nextSource)
      setStatus(nextSource ? 'ready' : settledStatus)
      if (nextSource) setLoadingState('loadingVrm', 55)
      else setLoadingState(settledStatus === 'ready' ? 'ready' : 'waitingTool', settledStatus === 'ready' ? 100 : 20)
      setErrorMsg('')
    } catch (error) {
      setResolvedSource(null)
      setStatus('error')
      setLoadingState('error', 100)
      setErrorMsg(`VRM の取得に失敗しました: ${String(error)}`)
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
          const inputModelId = extractModelIdFromInput(params)
          if (inputPayload) await applyPayload(inputPayload, 'waiting')
          else if (inputModelId || inputHasSegments(params)) await applyModelPreview(inputModelId)
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
          playback.clearSegments()
          setStatus('error')
          setLoadingState('error', 100)
          setErrorMsg(extractErrorMessage(result))
          return
        }

        const payload = extractPayloadFromResult(result)
        const managerRequest = readModelManagerRequest(result)
        if (managerRequest) {
          setModelManagerRequest((previous) => ({
            mode: managerRequest.mode,
            modelId: managerRequest.modelId,
            nonce: (previous?.nonce ?? 0) + 1,
          }))
        }

        if (!payload && !isPlayerToolResult(result) && !managerRequest) {
          return
        }
        if (!payload && !isPlayerToolResult(result) && managerRequest) {
          setLoadingState('ready', 100)
          return
        }

        setLoadingModel(true)
        setLoadingState('resolvingModel', 25)
        try {
          // 結果に含まれる vrmModel から表示中モデル情報を更新する（モデル切替時の話者解決に使う）。
          const meta = readToolMeta(result)
          const structured = result.structuredContent as Record<string, unknown> | undefined
          if (structured && typeof structured === 'object' && 'vrmModel' in structured) {
            const vm = structured.vrmModel as Record<string, unknown> | undefined
            if (vm && typeof vm.id === 'string' && typeof vm.name === 'string' && typeof vm.speakerId === 'number') {
              setResolvedActiveModel({
                id: vm.id,
                name: vm.name,
                speakerId: vm.speakerId,
                poses: readModelPoses(vm.poses),
                emotionBindings: readEmotionBindings(vm.emotionBindings),
                thumbnailUrl: readDataUrl(vm),
              })
            }
          }

          if (payload) {
            await applyPayload(payload, 'ready')
          } else if (typeof meta.resolvedModelId === 'string' && meta.resolvedModelId.trim()) {
            await applyModelPreview(meta.resolvedModelId)
          } else if (isPlayerToolResult(result) && !sourceRef.current) {
            throw new Error('VRM データが tool result に含まれておらず、表示中のモデルもありません。')
          }

          // speak_player の新形式は segments[].pose を含むがレスポンスサイズの都合で
          // 音声バイナリは含めない。viewUUID で `_get_player_audio_for_player` を後追い
          // 取得し、index 整列でマージしてから再生を始める。
          const nextSegments = extractPoseSegmentsFromResult(result)
          if (nextSegments) {
            const viewUUID = typeof meta.viewUUID === 'string' && meta.viewUUID.trim() ? meta.viewUUID : undefined
            let segmentsForPlayback = nextSegments
            if (viewUUID) {
              const requestId = audioLoadRequestRef.current + 1
              audioLoadRequestRef.current = requestId
              try {
                const initialIndexes = nextSegments.slice(0, Math.min(2, nextSegments.length)).map((_, index) => index)
                segmentsForPlayback = await mergeSegmentAudioIndexes(
                  createdApp,
                  nextSegments,
                  viewUUID,
                  initialIndexes,
                  (progress) => setLoadingState('preparingAudio', progress)
                )
                ensurePlayableSegments(segmentsForPlayback.slice(0, initialIndexes.length), viewUUID)
                playback.startPlayback(segmentsForPlayback, { autoPlay: consumeAutoPlay(meta) })
                void updateSpeakerIcon(segmentsForPlayback[0]?.speaker)
                setLoadingState('ready', 100)

                const remainingIndexes = nextSegments
                  .map((_, index) => index)
                  .filter((index) => !initialIndexes.includes(index))
                if (remainingIndexes.length > 0) {
                  void mergeSegmentAudioIndexes(createdApp, segmentsForPlayback, viewUUID, remainingIndexes)
                    .then((completeSegments) => {
                      if (requestId !== audioLoadRequestRef.current) return
                      playback.updateSegments(completeSegments)
                    })
                    .catch((error) => {
                      if (requestId !== audioLoadRequestRef.current) return
                      setPlaybackError(`後続セグメントの音声取得に失敗しました: ${String(error)}`)
                    })
                }
                return
              } catch (error) {
                if (!isMissingPlayerSessionError(error)) throw error
                setLoadingState('preparingAudio', 65)
                segmentsForPlayback = await resynthesizeSegments(createdApp, activeModelRef.current, nextSegments, {
                  preferSegmentSpeaker: true,
                })
              }
            }
            ensurePlayableSegments(segmentsForPlayback, viewUUID)
            playback.startPlayback(segmentsForPlayback, { autoPlay: consumeAutoPlay(meta) })
            void updateSpeakerIcon(segmentsForPlayback[0]?.speaker)
            setLoadingState('ready', 100)
          } else if (isPlayerToolResult(result)) {
            playback.clearSegments()
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: playback.refreshCurrentVisuals uses current render callbacks and is intentionally triggered by pose library/current index changes
  useEffect(() => {
    poseLibraryRef.current = poseLibrary
    playback.refreshCurrentVisuals()
  }, [poseLibrary, playback.currentSegmentIndex])

  // App ハンドルが確立した直後は「ツール入力待ち」へ遷移させる。
  // 加えて、まだツール入出力が無いうちにデフォルト VRM をプリロードして
  // モデルピッカーに「現在のモデル」が見える状態を作る（指定なしで開かれた時の初期表示）。
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
    model: NonNullable<VrmPlayerState['activeModel']> | null,
    list: PoseSegment[],
    options: { preferSegmentSpeaker?: boolean } = {}
  ): Promise<PoseSegment[]> => {
    return Promise.all(
      list.map(async (segment, index) => {
        const binding = resolveEmotionBinding(model?.emotionBindings, segment.emotion)
        const speakerId = options.preferSegmentSpeaker ? segment.speaker : undefined
        const resolvedSpeakerId = speakerId ?? binding?.speakerId ?? model?.speakerId
        if (resolvedSpeakerId === undefined) {
          throw new Error(`セグメント ${index + 1} の speaker が不明です。`)
        }
        try {
          const result = await resynthesizeSegmentOnServer(currentApp, {
            speakerId: resolvedSpeakerId,
            text: segment.text,
            speedScale: segment.explicitSpeedScale,
            prePhonemeLength: segment.prePhonemeLength,
            postPhonemeLength: segment.postPhonemeLength,
          })
          return {
            ...segment,
            audioBase64: result.audioBase64,
            audioMimeType: result.audioMimeType,
            speaker: resolvedSpeakerId,
            speedScale: result.speedScale ?? segment.speedScale,
            audioQuery: result.audioQuery ?? segment.audioQuery,
            prePhonemeLength: result.prePhonemeLength,
            postPhonemeLength: result.postPhonemeLength,
          }
        } catch (e) {
          throw new Error(
            `セグメント ${index + 1} の再合成に失敗しました: ${e instanceof Error ? e.message : String(e)}`
          )
        }
      })
    )
  }

  const resynthesizeAll = async (): Promise<void> => {
    const currentApp = appRef.current
    const model = activeModel
    const existing = playback.segmentsRef.current
    if (!currentApp || !model || existing.length === 0) return

    setLoadingModel(true)
    setLoadingState('preparingAudio', 65)
    try {
      playback.startPlayback(await resynthesizeSegments(currentApp, model, existing))
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
      const { metadata, payload } = await fetchVrmModelOnServer(currentApp, modelId)
      const { source: nextSource, error, revokeUrl } = await resolveVrmSource(currentApp, payload, { isDefault: false })
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
      rememberActiveModel(metadata.id)
      setResolvedActiveModel({
        id: metadata.id,
        name: metadata.name,
        speakerId: metadata.speakerId,
        poses: metadata.poses,
        emotionBindings: metadata.emotionBindings,
        thumbnailUrl:
          metadata.thumbnailBase64 !== undefined
            ? `data:${metadata.thumbnailMimeType ?? 'image/png'};base64,${metadata.thumbnailBase64}`
            : undefined,
      })
      void updateSpeakerIcon(metadata.speakerId)
      setStatus('ready')
      setErrorMsg('')

      const existing = playback.segmentsRef.current
      if (existing.length > 0) {
        setLoadingState('preparingAudio', 65)
        playback.startPlayback(
          await resynthesizeSegments(
            currentApp,
            {
              id: metadata.id,
              name: metadata.name,
              speakerId: metadata.speakerId,
              poses: metadata.poses,
              emotionBindings: metadata.emotionBindings,
              thumbnailUrl:
                metadata.thumbnailBase64 !== undefined
                  ? `data:${metadata.thumbnailMimeType ?? 'image/png'};base64,${metadata.thumbnailBase64}`
                  : undefined,
            },
            existing
          )
        )
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
    pose: playback.pose,
    expression: playback.expression,
    segments: playback.segments,
    currentSegmentIndex: playback.currentSegmentIndex,
    currentTime: playback.currentTime,
    duration: playback.duration,
    currentSegmentText: playback.currentSegmentText,
    currentSegmentGaze: playback.currentSegmentGaze,
    speakerIconUrl,
    activeModel,
    isPlaying: playback.isPlaying,
    canReplay: playback.canReplay,
    hasSegments: playback.hasSegments,
    isReadyForDisplay: Boolean(app),
    app: app ?? null,
    modelManagerRequest,
    switchVrm,
    play: playback.play,
    pause: playback.pause,
    prev: playback.prev,
    next: playback.next,
    resynthesizeAll,
    // `<VRMScene>` 内のロードエラー通知。別モデルへの暗黙フォールバックは行わず、
    // 実際に失敗したモデルのエラーを表示する。
    setModelError: (message: string) => {
      setStatus('error')
      setLoadingState('error', 100)
      setErrorMsg(message)
    },
    notifyVrmLoadStart,
    notifyVrmLoaded,
    mouthRef: lipSync.mouthRef,
  }
}
