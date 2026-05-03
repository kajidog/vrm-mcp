import { useVrmFileDrop } from '../hooks/useVrmFileDrop'
import type { VrmSource } from '../types'
import { VRMCanvas } from './VRMCanvas'

interface VRMPlayerProps {
  source: VrmSource | null
  loadingModel: boolean
  onLocalFile: (file: File) => Promise<void>
  onModelError: (message: string) => void
  // ヘッダ右の「メニュー」ボタン押下時に呼ばれる。VRM 一覧画面への遷移用。
  // 渡されない場合はボタンを描画しない。
  onOpenMenu?: () => void
}

/**
 * Player UI のレイアウト。ヘッダ（ラベル/状態/ファイルボタン）と
 * 3D プレビュー（VRMCanvas）を並べ、外側 div で D&D を受ける。
 * source が null のときも Canvas は常に出すので「空の空間」が表示される。
 */
export function VRMPlayer({ source, loadingModel, onLocalFile, onModelError, onOpenMenu }: VRMPlayerProps) {
  const { isDragging, openFilePicker, dropHandlers, inputProps } = useVrmFileDrop({ onFile: onLocalFile })

  return (
    <div
      // ドラッグ中はアクセントカラーで枠を強調してドロップ可能領域を可視化する。
      className={`space-y-3 p-3 ${isDragging ? 'outline-2 outline-offset-[-6px] outline-[var(--ui-accent)]' : ''}`}
      {...dropHandlers}
    >
      <input {...inputProps} />
      <div className="flex items-center justify-between rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--ui-text)]">VRM Preview</div>
          <div className="truncate text-xs text-[var(--ui-text-secondary)]">
            {source?.label ?? 'vrmUrl / vrmBase64 / vrmResourceUri を待機中'}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--ui-text-secondary)]">
          {loadingModel ? <div className="vv-spinner-sm" /> : null}
          {source ? 'ready' : 'idle'}
          <button
            type="button"
            className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
            onClick={openFilePicker}
          >
            file
          </button>
          {onOpenMenu ? (
            <button
              type="button"
              className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
              onClick={onOpenMenu}
            >
              メニュー
            </button>
          ) : null}
        </div>
      </div>

      <VRMCanvas source={source} onError={onModelError} />
    </div>
  )
}
