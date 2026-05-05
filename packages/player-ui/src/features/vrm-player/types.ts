// Player の遷移状態。connecting=MCP App 接続前、waiting=ツール入力待ち、
// ready=モデル表示中（または空表示）、error=エラー表示。
export type VrmPlayerStatus = 'connecting' | 'waiting' | 'ready' | 'error'

// 解決済みの VRM ソース。url 経由なら src、バイナリ展開済みなら data を持つ。
// isDefault はモデルエラー時のフォールバック判断に使う。
export interface VrmSource {
  src?: string
  data?: ArrayBuffer
  label: string
  note?: string
  isDefault?: boolean
}

// MCP ツール入出力に含まれる VRM ペイロードの想定スキーマ。
// `vrm*` を一次キー、`model*` を後方互換のエイリアスとして受け付ける。
export interface VrmPayload {
  vrmUrl?: string
  vrmBase64?: string
  vrmMimeType?: string
  vrmPath?: string
  vrmResourceUri?: string
  modelUrl?: string
  modelBase64?: string
  modelMimeType?: string
  modelPath?: string
  modelResourceUri?: string
}

import type { MouthRef } from './hooks/useLipSync'
import type { PoseSegment } from './utils/vrmPayload'

// useVrmPlayerApp が公開するビュー向け状態と操作。
// `app` はサーバー向けツール呼び出しが必要な兄弟ビュー（VRM 一覧画面など）に
// 共有するためのハンドル。確立前は null。
export interface VrmPlayerState {
  status: VrmPlayerStatus
  errorMsg: string
  source: VrmSource | null
  loadingModel: boolean
  isReadyForDisplay: boolean
  app: import('@modelcontextprotocol/ext-apps').App | null
  // 直近の speak_player 呼び出しで指示された現在のポーズID（idle 等）。未指定時は undefined。
  pose: string | undefined
  // 直近の speak_player 結果から取り出した全セグメント。再生されていなければ空配列。
  segments: PoseSegment[]
  // 現在再生中のセグメントの index（再生していないときは null）。
  currentSegmentIndex: number | null
  currentTime: number
  duration: number
  // 吹き出し表示用に切り出した「現在再生中のセグメントのテキスト」。
  currentSegmentText: string | null
  speakerIconUrl?: string
  // 現在表示している登録モデル情報（モデル切替で更新）。
  activeModel: { id: string; name: string; speakerId: number; thumbnailUrl?: string } | null
  // 表示モデルを別の登録モデルへ切替し、必要なら現セグメントを新 speaker で再合成する。
  switchVrm: (modelId: string) => Promise<void>
  play: () => void
  pause: () => void
  prev: () => void
  next: () => void
  isPlaying: boolean
  canReplay: boolean
  // セグメントが 1 件以上あるか。Pause 中も true（操作ボタン活性化判定に使う）。
  hasSegments: boolean
  resynthesizeAll: (settings?: {
    speedScale?: number
    prePhonemeLength?: number
    postPhonemeLength?: number
  }) => Promise<void>
  setModelError: (message: string) => void
  // 再生中音声のリップシンク値（aa/ih/ou/ee/oh）。VRMScene が毎フレーム参照する。
  mouthRef: MouthRef
}
