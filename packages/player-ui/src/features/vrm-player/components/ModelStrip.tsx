import type { App } from '@modelcontextprotocol/ext-apps'
import { useEffect, useState } from 'react'
import { PencilIcon, PlusCircleIcon } from '../../../icons'
import { fetchVrmListOnServer } from '../hooks/vrmPlayerToolClient'

interface ModelStripEntry {
  id: string
  name: string
  speakerId: number
  isDefault?: boolean
  thumbnailBase64?: string
  thumbnailMimeType?: string
}

interface ModelStripProps {
  app: App | null
  activeModelId: string | null
  busy: boolean
  refreshKey: number
  onSelect: (modelId: string) => void
  onAdd: () => void
  onEdit: (modelId: string) => void
}

export function ModelStrip({ app, activeModelId, busy, refreshKey, onSelect, onAdd, onEdit }: ModelStripProps) {
  const [items, setItems] = useState<ModelStripEntry[]>([])

  // refreshKey は親が保存/編集後に一覧を再取得させるための明示的な bump。
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey intentionally retriggers the server list fetch
  useEffect(() => {
    if (!app) return
    let cancelled = false
    fetchVrmListOnServer(app)
      .then((list) => {
        if (!cancelled) setItems(list)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [app, refreshKey])

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {items.slice(0, 8).map((item) => {
        const active = item.id === activeModelId
        return (
          <div key={item.id} className="group relative shrink-0">
            <button
              type="button"
              disabled={busy || active}
              title={`${item.name} / 話者${item.speakerId}`}
              onClick={() => onSelect(item.id)}
              className={`flex h-10 min-w-10 items-center justify-center overflow-hidden rounded-md border px-2 text-xs font-semibold ${
                active
                  ? 'border-[var(--ui-accent)] bg-[var(--ui-accent)] text-white'
                  : 'border-[var(--ui-border)] bg-[var(--ui-button-bg)] text-[var(--ui-text)] hover:border-[var(--ui-accent)]'
              } disabled:opacity-70`}
            >
              {item.thumbnailBase64 ? (
                <img
                  src={`data:${item.thumbnailMimeType ?? 'image/png'};base64,${item.thumbnailBase64}`}
                  alt={item.name}
                  className="h-10 w-10 object-cover"
                />
              ) : (
                <span className="max-w-20 truncate">{shortName(item.name)}</span>
              )}
            </button>
            <button
              type="button"
              title="Edit"
              onClick={() => onEdit(item.id)}
              className="absolute -right-1 -bottom-1 hidden h-5 w-5 items-center justify-center rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] shadow group-hover:flex"
            >
              <PencilIcon />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        title="Add model"
        onClick={onAdd}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--ui-border)] bg-[var(--ui-button-bg)] text-[var(--ui-text-secondary)] hover:border-[var(--ui-accent)] hover:text-[var(--ui-accent)]"
      >
        <PlusCircleIcon />
      </button>
    </div>
  )
}

function shortName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length <= 6) return trimmed
  return trimmed.slice(0, 6)
}
