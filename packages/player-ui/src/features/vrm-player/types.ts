// Player の遷移状態。connecting=MCP App 接続前、waiting=ツール入力待ち、
// ready=モデル表示中（または空表示）、error=エラー表示。
export type VrmPlayerStatus = 'connecting' | 'waiting' | 'ready' | 'error'

// 解決済みの VRM ソース。url 経由なら src、バイナリ展開済みなら data を持つ。
// isDefault / isLocal はモデルエラー時のフォールバック判断に使う。
export interface VrmSource {
  src?: string
  data?: ArrayBuffer
  label: string
  note?: string
  isDefault?: boolean
  isLocal?: boolean
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
  loadLocalVrmFile: (file: File) => Promise<void>
  setModelError: (message: string) => void
}
