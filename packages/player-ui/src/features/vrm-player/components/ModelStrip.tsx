import type { App } from '@modelcontextprotocol/ext-apps'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { PencilIcon, PlusCircleIcon } from '~/icons'
import { fetchVrmListOnServer } from '../hooks/vrmPlayerToolClient'

interface ModelStripEntry {
  id: string
  name: string
  speakerId: number
  isDefault?: boolean
  isPublic?: boolean
  canEdit?: boolean
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
  const orderedItems = useMemo(
    () => [...items].sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true)),
    [items]
  )
  const visibleItems = useMemo(() => orderedItems.slice(0, 8), [orderedItems])
  const lastDefaultIndex = visibleItems.reduce((last, item, index) => (item.isDefault ? index : last), -1)

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
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden">
      {visibleItems.map((item, index) => {
        const active = item.id === activeModelId
        const showDefaultDivider = lastDefaultIndex === index && index < visibleItems.length - 1
        return (
          <Fragment key={item.id}>
            <div className="group relative shrink-0">
              <button
                type="button"
                disabled={busy}
                title={`${item.name}${item.isDefault ? ' (デフォルト)' : ''}`}
                onClick={() => {
                  if (!active) onSelect(item.id)
                }}
                className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 p-0 text-xs font-semibold ${
                  active
                    ? 'border-[var(--ui-accent)] bg-[var(--ui-button-bg)] text-[var(--ui-text)]'
                    : 'border-transparent bg-[var(--ui-button-bg)] text-[var(--ui-text)] ring-1 ring-[var(--ui-border)] hover:border-[var(--ui-accent)] cursor-pointer'
                } disabled:opacity-70`}
              >
                {item.thumbnailBase64 ? (
                  <img
                    src={`data:${item.thumbnailMimeType ?? 'image/png'};base64,${item.thumbnailBase64}`}
                    alt={item.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="max-w-9 truncate px-1">{shortName(item.name)}</span>
                )}
              </button>
              {item.canEdit === false ? null : (
                <button
                  type="button"
                  title="編集"
                  onClick={() => onEdit(item.id)}
                  className="absolute cursor-pointer -right-1 -bottom-1 hidden h-5 w-5 items-center justify-center rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text)] shadow group-hover:flex hover:bg-[var(--ui-button-bg)] hover:border-[var(--ui-accent)]"
                >
                  <PencilIcon />
                </button>
              )}
            </div>
            {showDefaultDivider ? (
              <div aria-hidden="true" className="mx-1 h-8 w-px shrink-0 bg-[var(--ui-border)]" />
            ) : null}
          </Fragment>
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
