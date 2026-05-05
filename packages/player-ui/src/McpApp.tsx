import { useState } from 'react'
import { SettingsView } from './features/vrm-player/components/SettingsView'
import { VRMPlayer } from './features/vrm-player/components/VRMPlayer'
import { useDisplayMode } from './features/vrm-player/hooks/useDisplayMode'
import { useVrmPlayerApp } from './features/vrm-player/hooks/useVrmPlayerApp'
import { VrmRegisterView } from './features/vrm-registry/VrmRegisterView'

type View = 'player' | 'settings' | 'register' | 'edit'

function LoadingView({ label }: { label: string }) {
  return (
    <div className="initial-loading-overlay">
      <div className="flex items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg)] px-4 py-3 text-sm font-medium text-[var(--ui-text)] shadow-lg">
        <div className="vv-spinner" />
        {label}
      </div>
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

export function McpApp() {
  const [view, setView] = useState<View>('player')
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [listRefreshKey, setListRefreshKey] = useState(0)
  const player = useVrmPlayerApp()
  const displayMode = useDisplayMode(player.app)
  const fullscreen = displayMode.displayMode === 'fullscreen'

  if (player.status === 'connecting') {
    return <LoadingView label="Connecting..." />
  }

  if (!player.isReadyForDisplay || !player.app) {
    // App ハンドル未確立のあいだはレイアウトを描かない（Connection error 表示は下の error 分岐で）。
    if (player.status === 'error') return <ErrorView message={player.errorMsg} />
    return null
  }

  if (view === 'register' || view === 'edit') {
    return (
      <VrmRegisterView
        app={player.app}
        modelId={view === 'edit' ? editingModelId : null}
        onBack={() => setView('player')}
        onSaved={() => {
          setEditingModelId(null)
          setListRefreshKey((value) => value + 1)
          setView('player')
        }}
      />
    )
  }

  if (view === 'settings') {
    return (
      <SettingsView
        app={player.app}
        busy={player.loadingModel}
        onBack={() => setView('player')}
        onOpenModels={() => setView('player')}
        onApplied={async () => {
          await player.resynthesizeAll()
          setView('player')
        }}
      />
    )
  }

  if (player.status === 'error') {
    return <ErrorView message={player.errorMsg} />
  }

  return (
    <div data-display-mode={displayMode.displayMode} className="relative">
      <VRMPlayer
        app={player.app}
        source={player.source}
        loadingModel={player.loadingModel}
        pose={player.pose}
        speechText={player.currentSegmentText}
        activeModelId={player.activeModel?.id ?? null}
        listRefreshKey={listRefreshKey}
        isPlaying={player.isPlaying}
        canReplay={player.canReplay}
        hasSegments={player.hasSegments}
        currentIndex={player.currentSegmentIndex}
        totalSegments={player.segments.length}
        currentTime={player.currentTime}
        duration={player.duration}
        speakerName={
          player.currentSegmentIndex !== null
            ? (player.segments[player.currentSegmentIndex]?.speakerName ?? null)
            : (player.segments[0]?.speakerName ?? null)
        }
        thumbnailUrl={player.speakerIconUrl}
        fullscreen={fullscreen}
        canFullscreen={displayMode.canFullscreen}
        mouthRef={player.mouthRef}
        onSwitchVrm={player.switchVrm}
        onPlay={player.play}
        onPause={player.pause}
        onPrev={player.prev}
        onNext={player.next}
        onModelError={player.setModelError}
        onOpenSettings={() => setView('settings')}
        onAddModel={() => {
          setEditingModelId(null)
          setView('register')
        }}
        onEditModel={(modelId) => {
          setEditingModelId(modelId)
          setView('edit')
        }}
        onToggleFullscreen={() => {
          if (fullscreen) void displayMode.requestInline()
          else void displayMode.requestFullscreen()
        }}
      />
      {player.status === 'waiting' && player.loadingModel ? <LoadingView label="Loading model..." /> : null}
    </div>
  )
}
