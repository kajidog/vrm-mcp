import type { App } from '@modelcontextprotocol/ext-apps'
import { useApp } from '@modelcontextprotocol/ext-apps/react'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useEffect, useRef, useState } from 'react'
import type { VrmPayload, VrmPlayerState, VrmPlayerStatus } from '../types'
import { extractPayloadFromInput, extractPayloadFromResult } from '../utils/vrmPayload'
import { resolveVrmSource } from '../utils/vrmSource'
import { useRevokableObjectUrl } from './useRevokableObjectUrl'
import { fetchDefaultVrmOnServer } from './vrmPlayerToolClient'

// `connecting` を除く「落ち着いた」表示状態。`applyPayload` の fallback に使う。
type SettledStatus = Exclude<VrmPlayerStatus, 'connecting'>

// CallToolResult の text コンテンツをエラーメッセージとして取り出す。
function extractErrorMessage(result: CallToolResult): string {
  const text = result.content?.find((content) => content.type === 'text')
  return text?.type === 'text' ? text.text : 'Unknown error'
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
  const appRef = useRef<App | null>(null)
  // `setModelError` から「現在表示中のソース種別」を同期参照するための ref。
  const sourceRef = useRef<VrmPlayerState['source']>(null)
  const { replaceObjectUrl } = useRevokableObjectUrl()

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
    capabilities: {},
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
          setStatus('error')
          setErrorMsg(extractErrorMessage(result))
          return
        }

        await applyPayload(extractPayloadFromResult(result), 'ready')
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

  return {
    status,
    errorMsg,
    source,
    loadingModel,
    isReadyForDisplay: Boolean(app),
    app: app ?? null,
    // ユーザーがローカル VRM をドロップ/選択したときの取り込み処理。
    loadLocalVrmFile: async (file: File) => {
      const fileName = file.name || 'local VRM'
      if (!fileName.toLowerCase().endsWith('.vrm')) {
        setStatus('error')
        setErrorMsg('VRM ファイル（.vrm）を選択してください。')
        return
      }

      setLoadingModel(true)
      try {
        replaceObjectUrl(null)
        setResolvedSource({
          data: await file.arrayBuffer(),
          label: fileName,
          note: 'ローカルファイルを表示中',
          isLocal: true,
        })
        setStatus('ready')
        setErrorMsg('')
      } catch (error) {
        setStatus('error')
        setErrorMsg(`ローカル VRM の読み込みに失敗しました: ${String(error)}`)
      } finally {
        setLoadingModel(false)
      }
    },
    // `<VRMScene>` 内のロードエラー通知。
    // 既に default/local 表示中なら再フォールバックせずエラー表示に切り替える
    // （無限フォールバックを防ぐため）。
    setModelError: (message: string) => {
      if (sourceRef.current?.isDefault || sourceRef.current?.isLocal) {
        setStatus('error')
        setErrorMsg(message)
        return
      }

      setLoadingModel(true)
      void applyDefaultPayload(message).finally(() => setLoadingModel(false))
    },
  }
}
