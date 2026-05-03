import { useState } from 'react'
import { VRMPlayer } from './features/vrm-player/components/VRMPlayer'
import { useVrmPlayerApp } from './features/vrm-player/hooks/useVrmPlayerApp'
import { VrmListView } from './features/vrm-registry/VrmListView'

// Phase 2 では player ↔ list の往復だけ。register / edit は Phase 3 で実装。
type View = 'player' | 'list' | 'register' | 'edit'

function LoadingView({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 p-3">
      <div className="vv-spinner" />
      {label}
    </div>
  )
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <div className="font-semibold">VRM を表示できませんでした</div>
      <div>{message}</div>
    </div>
  )
}

// Phase 3 で実装する登録 / 編集画面のスタブ。今は「戻る」だけ提供しておく。
function ComingSoonView({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
        >
          ← 一覧に戻る
        </button>
        <div className="text-sm font-semibold text-[var(--ui-text)]">{label}</div>
        <div className="w-12" />
      </div>
      <div className="rounded-xl border border-dashed border-[var(--ui-border)] bg-[var(--ui-surface)] p-6 text-center text-sm text-[var(--ui-text-secondary)]">
        この画面は Phase 3 で実装予定です。
      </div>
    </div>
  )
}

export function McpApp() {
  const [view, setView] = useState<View>('player')
  const player = useVrmPlayerApp()

  if (player.status === 'connecting') {
    return <LoadingView label="Connecting..." />
  }

  if (!player.isReadyForDisplay || !player.app) {
    // App ハンドル未確立のあいだはレイアウトを描かない（Connection error 表示は下の error 分岐で）。
    if (player.status === 'error') return <ErrorView message={player.errorMsg} />
    return null
  }

  if (view === 'list') {
    return (
      <VrmListView
        app={player.app}
        onBack={() => setView('player')}
        onAdd={() => setView('register')}
        onEdit={() => setView('edit')}
      />
    )
  }

  if (view === 'register') {
    return <ComingSoonView label="VRM を追加" onBack={() => setView('list')} />
  }

  if (view === 'edit') {
    return <ComingSoonView label="VRM を編集" onBack={() => setView('list')} />
  }

  if (player.status === 'error') {
    return <ErrorView message={player.errorMsg} />
  }

  return (
    <VRMPlayer
      source={player.source}
      loadingModel={player.loadingModel}
      onLocalFile={player.loadLocalVrmFile}
      onModelError={player.setModelError}
      onOpenMenu={() => setView('list')}
    />
  )
}
