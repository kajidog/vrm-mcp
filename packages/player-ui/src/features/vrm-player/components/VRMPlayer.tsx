import type { App } from '@modelcontextprotocol/ext-apps'
import type { PosePresetId } from '../../poses/presets'
import { POSE_PRESETS } from '../../poses/presets'
import type { VrmSource } from '../types'
import { PlayerHeader } from './PlayerHeader'
import { SettingsModal } from './SettingsModal'
import { VRMCanvas } from './VRMCanvas'

interface VRMPlayerProps {
  app: App | null
  source: VrmSource | null
  loadingModel: boolean
  pose?: string
  speechText: string | null
  activeModelId: string | null
  listRefreshKey: number
  isPlaying: boolean
  canReplay: boolean
  settingsOpen: boolean
  fullscreen: boolean
  canFullscreen: boolean
  onModelError: (message: string) => void
  onSwitchVrm: (modelId: string) => Promise<void>
  onPlay: () => void
  onPause: () => void
  onPrev: () => void
  onNext: () => void
  onOpenSettings: () => void
  onCloseSettings: () => void
  onSettingsApplied: () => Promise<void>
  onAddModel: () => void
  onEditModel: (modelId: string) => void
  onOpenModels: () => void
  onToggleFullscreen: () => void
}

function asPresetId(value: string | undefined): PosePresetId | undefined {
  if (!value) return undefined
  return value in POSE_PRESETS ? (value as PosePresetId) : undefined
}

export function VRMPlayer({
  app,
  source,
  loadingModel,
  pose,
  speechText,
  activeModelId,
  listRefreshKey,
  isPlaying,
  canReplay,
  settingsOpen,
  fullscreen,
  canFullscreen,
  onModelError,
  onSwitchVrm,
  onPlay,
  onPause,
  onPrev,
  onNext,
  onOpenSettings,
  onCloseSettings,
  onSettingsApplied,
  onAddModel,
  onEditModel,
  onOpenModels,
  onToggleFullscreen,
}: VRMPlayerProps) {
  const presetPose = asPresetId(pose)

  return (
    <div className={fullscreen ? 'flex h-full min-h-0 flex-col gap-2 p-2' : 'space-y-3 p-3'}>
      <PlayerHeader
        app={app}
        activeModelId={activeModelId}
        loadingModel={loadingModel}
        listRefreshKey={listRefreshKey}
        hasSegments={canReplay || isPlaying}
        isPlaying={isPlaying}
        canReplay={canReplay}
        fullscreen={fullscreen}
        canFullscreen={canFullscreen}
        onSwitchVrm={(modelId) => {
          void onSwitchVrm(modelId)
        }}
        onAddModel={onAddModel}
        onEditModel={onEditModel}
        onPlay={onPlay}
        onPause={onPause}
        onPrev={onPrev}
        onNext={onNext}
        onOpenSettings={onOpenSettings}
        onToggleFullscreen={onToggleFullscreen}
      />
      <div className={fullscreen ? 'min-h-0 flex-1' : undefined}>
        <VRMCanvas
          source={source}
          onError={onModelError}
          pose={presetPose}
          speechText={speechText}
          fullscreen={fullscreen}
        />
      </div>
      <SettingsModal
        app={app}
        open={settingsOpen}
        busy={loadingModel}
        onClose={onCloseSettings}
        onOpenModels={onOpenModels}
        onApplied={onSettingsApplied}
      />
    </div>
  )
}
