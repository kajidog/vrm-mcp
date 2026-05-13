import { useEffect, useState } from 'react'
import { PoseListView } from './features/poses/PoseListView'
import { RenderSettingsPanel } from './features/vrm-player/components/RenderSettingsPanel'
import { SettingsView } from './features/vrm-player/components/SettingsView'
import { VRMPlayer } from './features/vrm-player/components/VRMPlayer'
import { useDisplayMode } from './features/vrm-player/hooks/useDisplayMode'
import { useVrmPlayerApp } from './features/vrm-player/hooks/useVrmPlayerApp'
import type { VrmPlayerLoadingPhase } from './features/vrm-player/types'
import { VrmRegisterView } from './features/vrm-registry/VrmRegisterView'

type View = 'player' | 'settings' | 'register' | 'edit' | 'poses'

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

function loadingLabel(phase: VrmPlayerLoadingPhase): string {
  if (phase === 'loadingVrm' || phase === 'resolvingModel') return 'VRMロード中'
  if (phase === 'preparingAudio') return '音声準備中'
  return 'ローディング中'
}

function LoadingOverlay({ phase, progress }: { phase: VrmPlayerLoadingPhase; progress: number }) {
  const value = Math.min(100, Math.max(0, Math.round(progress)))
  return (
    <div className="player-loading-overlay" aria-live="polite" aria-busy="true">
      <div className="player-loading-panel">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ui-text)]">
          <div className="vv-spinner" />
          {loadingLabel(phase)}
        </div>
        <div className="h-2 w-56 overflow-hidden rounded-full bg-[var(--ui-progress-bg)]">
          <div
            className="h-full rounded-full bg-[var(--ui-accent)] transition-[width] duration-200"
            style={{ width: `${value}%` }}
          />
        </div>
        <div className="text-right text-xs tabular-nums text-[var(--ui-text-secondary)]">{value}%</div>
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

function ErrorStatus({ message }: { message: string }) {
  return (
    <div className="mx-3 mb-3 shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      <span className="font-semibold">エラー: </span>
      {message}
    </div>
  )
}

export function McpApp() {
  const [view, setView] = useState<View>('player')
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [listRefreshKey, setListRefreshKey] = useState(0)
  // 表示系設定（renderSettings）はプレイヤーを裏で動かしたままドロワーで開閉する。
  // 音声系（PlayerSettings）は view='settings' で全画面遷移。
  const [renderPanelOpen, setRenderPanelOpen] = useState(false)
  const player = useVrmPlayerApp()
  const displayMode = useDisplayMode(player.app)
  const fullscreen = displayMode.displayMode === 'fullscreen'

  useEffect(() => {
    const request = player.modelManagerRequest
    if (!request) return
    setEditingModelId(request.mode === 'edit' ? request.modelId : null)
    setView(request.mode)
  }, [player.modelManagerRequest])

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
      <div
        data-display-mode={displayMode.displayMode}
        data-scrollable={fullscreen ? 'true' : undefined}
        className={fullscreen ? 'h-full min-h-0 overflow-y-auto' : 'relative'}
      >
        <VrmRegisterView
          app={player.app}
          modelId={view === 'edit' ? editingModelId : null}
          onBack={() => setView('player')}
          onSaved={(savedModelId) => {
            setEditingModelId(null)
            setListRefreshKey((value) => value + 1)
            setView('player')
            if (savedModelId) void player.switchVrm(savedModelId)
          }}
          fullscreen={fullscreen}
          canFullscreen={displayMode.canFullscreen}
          onToggleFullscreen={() => {
            if (fullscreen) void displayMode.requestInline()
            else void displayMode.requestFullscreen()
          }}
        />
      </div>
    )
  }

  if (view === 'settings') {
    return (
      <SettingsView
        app={player.app}
        busy={player.loadingModel}
        onBack={() => setView('player')}
        onOpenPoses={() => setView('poses')}
        onApplied={async () => {
          await player.resynthesizeAll()
          setView('player')
        }}
      />
    )
  }

  if (view === 'poses') {
    return <PoseListView app={player.app} onBack={() => setView('player')} />
  }

  const preparing = player.loadingPhase !== 'idle' && player.loadingPhase !== 'ready' && player.loadingPhase !== 'error'
  const playerRootClassName = [fullscreen ? 'min-h-0 flex-1' : '', preparing ? 'player-root-preparing' : '']
    .filter(Boolean)
    .join(' ')
  const showErrorStatus = player.status === 'error' && player.errorMsg

  return (
    <div
      data-display-mode={displayMode.displayMode}
      className={fullscreen ? 'relative flex h-full min-h-0 flex-col' : 'relative'}
    >
      <div className={playerRootClassName || undefined} aria-hidden={preparing}>
        <VRMPlayer
          app={player.app}
          source={player.source}
          loadingModel={player.loadingModel}
          pose={player.pose}
          expression={player.expression}
          speechText={player.currentSegmentText}
          gaze={player.currentSegmentGaze}
          activeModelId={player.activeModel?.id ?? null}
          listRefreshKey={listRefreshKey}
          isPlaying={player.isPlaying}
          canReplay={player.canReplay}
          hasSegments={player.hasSegments}
          currentIndex={player.currentSegmentIndex}
          totalSegments={player.segments.length}
          currentTime={player.currentTime}
          duration={player.duration}
          fullscreen={fullscreen}
          canFullscreen={displayMode.canFullscreen}
          mouthRef={player.mouthRef}
          onSwitchVrm={player.switchVrm}
          onPlay={player.play}
          onPause={player.pause}
          onPrev={player.prev}
          onNext={player.next}
          onModelError={player.setModelError}
          onVrmLoadStart={player.notifyVrmLoadStart}
          onVrmLoaded={player.notifyVrmLoaded}
          onOpenSettings={() => setRenderPanelOpen(true)}
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
      </div>
      {showErrorStatus ? <ErrorStatus message={player.errorMsg} /> : null}
      {preparing ? <LoadingOverlay phase={player.loadingPhase} progress={player.loadingProgress} /> : null}
      {renderPanelOpen ? (
        <RenderSettingsPanel
          onClose={() => setRenderPanelOpen(false)}
          onOpenServerSettings={() => {
            setRenderPanelOpen(false)
            setView('settings')
          }}
          onOpenPoses={() => {
            setRenderPanelOpen(false)
            setView('poses')
          }}
        />
      ) : null}
    </div>
  )
}
