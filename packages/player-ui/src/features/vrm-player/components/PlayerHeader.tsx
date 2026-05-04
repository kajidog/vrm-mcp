import type { App } from '@modelcontextprotocol/ext-apps'
import { FullscreenExitIcon, FullscreenIcon, SettingsIcon } from '../../../icons'
import { ModelStrip } from './ModelStrip'
import { TransportBar } from './TransportBar'

interface PlayerHeaderProps {
  app: App | null
  activeModelId: string | null
  loadingModel: boolean
  listRefreshKey: number
  hasSegments: boolean
  isPlaying: boolean
  canReplay: boolean
  fullscreen: boolean
  canFullscreen: boolean
  onSwitchVrm: (modelId: string) => void
  onAddModel: () => void
  onEditModel: (modelId: string) => void
  onPlay: () => void
  onPause: () => void
  onPrev: () => void
  onNext: () => void
  onOpenSettings: () => void
  onToggleFullscreen: () => void
}

export function PlayerHeader({
  app,
  activeModelId,
  loadingModel,
  listRefreshKey,
  hasSegments,
  isPlaying,
  canReplay,
  fullscreen,
  canFullscreen,
  onSwitchVrm,
  onAddModel,
  onEditModel,
  onPlay,
  onPause,
  onPrev,
  onNext,
  onOpenSettings,
  onToggleFullscreen,
}: PlayerHeaderProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2 py-2">
      <ModelStrip
        app={app}
        activeModelId={activeModelId}
        busy={loadingModel}
        refreshKey={listRefreshKey}
        onSelect={onSwitchVrm}
        onAdd={onAddModel}
        onEdit={onEditModel}
      />
      <TransportBar
        isPlaying={isPlaying}
        canReplay={canReplay}
        hasSegments={hasSegments}
        onPlay={onPlay}
        onPause={onPause}
        onPrev={onPrev}
        onNext={onNext}
      />
      <div className="flex shrink-0 items-center gap-1">
        {loadingModel ? <div className="vv-spinner-sm" /> : null}
        <button
          type="button"
          title="Settings"
          onClick={onOpenSettings}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
        >
          <SettingsIcon />
        </button>
        {canFullscreen ? (
          <button
            type="button"
            title={fullscreen ? 'Inline' : 'Fullscreen'}
            onClick={onToggleFullscreen}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
          >
            {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
          </button>
        ) : null}
      </div>
    </div>
  )
}
