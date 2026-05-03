import type { App } from '@modelcontextprotocol/ext-apps'
import { useVrmRegistry } from './hooks/useVrmRegistry'
import type { VrmMetadata } from './types'

interface VrmListViewProps {
  app: App
  onBack: () => void
  onAdd: () => void
  onEdit: (modelId: string) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(timestamp: number): string {
  // ISO は冗長なので分単位までで十分。タイムゾーンはユーザーロケールに任せる。
  const d = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function VrmCard({
  vrm,
  busy,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  vrm: VrmMetadata
  busy: boolean
  onEdit: () => void
  onDelete: () => void
  onSetDefault: () => void
}) {
  return (
    <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold text-[var(--ui-text)]">{vrm.name}</div>
            {vrm.isDefault ? (
              <span className="rounded-full bg-[var(--ui-accent)] px-2 py-0.5 text-[10px] font-semibold text-white">
                デフォルト
              </span>
            ) : null}
            {vrm.isPublic ? (
              <span className="rounded-full bg-[var(--ui-tag-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ui-text-secondary)]">
                公開
              </span>
            ) : null}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-[var(--ui-text-secondary)]">
            <div>話者ID: {vrm.speakerId}</div>
            <div>サイズ: {formatBytes(vrm.vrmSizeBytes)}</div>
            <div className="col-span-2 truncate">更新: {formatDate(vrm.updatedAt)}</div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onEdit}
          className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)] disabled:opacity-50"
        >
          編集
        </button>
        <button
          type="button"
          disabled={busy || vrm.isDefault}
          onClick={onSetDefault}
          className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)] disabled:opacity-50"
        >
          デフォルトに設定
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="ml-auto rounded-md border border-[var(--ui-danger)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-danger)] hover:bg-[var(--ui-danger)] hover:text-white disabled:opacity-50"
        >
          削除
        </button>
      </div>
    </div>
  )
}

/**
 * 登録済み VRM の一覧画面。
 * - 「← プレイヤーに戻る」/「+ 追加」をヘッダ
 * - 各カードに 編集 / デフォルトに設定 / 削除
 *
 * 削除は破壊的だが confirm ダイアログだけで OK にしている。
 * （iframe 内の `window.confirm` は ext-apps の host 設定次第で出ない可能性があるが、
 * Phase 2 時点ではまずシンプルに実装し、必要なら独自モーダルへ差し替える）
 */
export function VrmListView({ app, onBack, onAdd, onEdit }: VrmListViewProps) {
  const { vrms, loading, error, refresh, remove, setDefault } = useVrmRegistry(app)

  const handleDelete = async (vrm: VrmMetadata) => {
    const ok = window.confirm(`「${vrm.name}」を削除しますか？この操作は取り消せません。`)
    if (!ok) return
    try {
      await remove(vrm.id)
    } catch (e) {
      window.alert(`削除に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleSetDefault = async (vrm: VrmMetadata) => {
    try {
      await setDefault(vrm.id)
    } catch (e) {
      window.alert(`デフォルト設定に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
        >
          ← プレイヤーに戻る
        </button>
        <div className="text-sm font-semibold text-[var(--ui-text)]">VRM 一覧</div>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-md border border-[var(--ui-accent)] bg-[var(--ui-accent)] px-2 py-1 text-xs font-semibold text-white hover:bg-[var(--ui-accent-hover)]"
        >
          + 追加
        </button>
      </div>

      {error ? (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <div className="font-semibold">VRM 一覧を取得できませんでした</div>
          <div>{error}</div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-100"
          >
            再試行
          </button>
        </div>
      ) : null}

      {loading && vrms.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-3 text-sm text-[var(--ui-text-secondary)]">
          <div className="vv-spinner" />
          読み込み中...
        </div>
      ) : null}

      {!loading && !error && vrms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--ui-border)] bg-[var(--ui-surface)] p-6 text-center text-sm text-[var(--ui-text-secondary)]">
          登録済みの VRM はありません。「+ 追加」から VRM を登録してください。
        </div>
      ) : null}

      <div className="space-y-2">
        {vrms.map((vrm) => (
          <VrmCard
            key={vrm.id}
            vrm={vrm}
            busy={loading}
            onEdit={() => onEdit(vrm.id)}
            onDelete={() => void handleDelete(vrm)}
            onSetDefault={() => void handleSetDefault(vrm)}
          />
        ))}
      </div>
    </div>
  )
}
