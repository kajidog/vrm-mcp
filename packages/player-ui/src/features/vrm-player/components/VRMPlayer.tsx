import type { App } from '@modelcontextprotocol/ext-apps'
import { POSE_PRESETS, type PosePresetId } from '~/features/poses/presets'
import type { MouthRef } from '../hooks/useLipSync'
import type { VrmSource } from '../types'
import { PlayerHeader } from './PlayerHeader'
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
  hasSegments: boolean
  currentIndex: number | null
  totalSegments: number
  currentTime: number
  duration: number
  speakerName: string | null
  thumbnailUrl?: string
  fullscreen: boolean
  canFullscreen: boolean
  mouthRef: MouthRef
  onModelError: (message: string) => void
  onSwitchVrm: (modelId: string) => Promise<void>
  onPlay: () => void
  onPause: () => void
  onPrev: () => void
  onNext: () => void
  onOpenSettings: () => void
  onAddModel: () => void
  onEditModel: (modelId: string) => void
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
  hasSegments,
  currentIndex,
  totalSegments,
  currentTime,
  duration,
  speakerName,
  thumbnailUrl,
  fullscreen,
  canFullscreen,
  mouthRef,
  onModelError,
  onSwitchVrm,
  onPlay,
  onPause,
  onPrev,
  onNext,
  onOpenSettings,
  onAddModel,
  onEditModel,
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
        hasSegments={hasSegments}
        isPlaying={isPlaying}
        canReplay={canReplay}
        currentIndex={currentIndex}
        totalSegments={totalSegments}
        currentTime={currentTime}
        duration={duration}
        speakerName={speakerName}
        thumbnailUrl={thumbnailUrl}
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
          currentIndex={currentIndex}
          totalSegments={totalSegments}
          fullscreen={fullscreen}
          hasSegments={hasSegments}
          mouthRef={mouthRef}
          onPrev={onPrev}
          onNext={onNext}
        />
      </div>
    </div>
  )
}
