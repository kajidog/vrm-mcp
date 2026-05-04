// VRM レジストリ UI が受け取るメタデータ。
// サーバ側 `_list_vrms_for_player` / `_register_vrm_for_player` が返す
// `vrmFilePath` を除いた形と一致させる。
//
// 注意: 共有パッケージ（`mcp-core` 等）からは import せず、UI 側で必要な
// 最小フィールドだけをここに定義する。将来複数アプリで共有が必要に
// なったら専用の VRM 型パッケージを切る方針（PLAM.md 参照）。
export interface VrmMetadata {
  id: string
  name: string
  speakerId: number
  isDefault: boolean
  isPublic: boolean
  vrmSizeBytes: number
  thumbnailBase64?: string
  thumbnailMimeType?: string
  createdAt: number
  updatedAt: number
}

export interface RegisterVrmRequest {
  name: string
  speakerId: number
  isDefault?: boolean
  isPublic?: boolean
  vrmBase64: string
}

export interface UpdateVrmRequest {
  name?: string
  speakerId?: number
  isDefault?: boolean
  isPublic?: boolean
}

export interface ReplaceVrmBinaryRequest {
  vrmBase64: string
}
