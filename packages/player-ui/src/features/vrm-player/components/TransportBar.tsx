import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from '../../../icons'

interface TransportBarProps {
  isPlaying: boolean
  canReplay: boolean
  hasSegments: boolean
  onPlay: () => void
  onPause: () => void
  onPrev: () => void
  onNext: () => void
}

export function TransportBar({
  isPlaying,
  canReplay,
  hasSegments,
  onPlay,
  onPause,
  onPrev,
  onNext,
}: TransportBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        title="Previous"
        disabled={!hasSegments}
        onClick={onPrev}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] text-[var(--ui-text)] hover:border-[var(--ui-accent)] disabled:opacity-40"
      >
        <PrevIcon />
      </button>
      <button
        type="button"
        title={isPlaying ? 'Pause' : canReplay ? 'Replay' : 'Play'}
        disabled={!hasSegments}
        onClick={isPlaying ? onPause : onPlay}
        className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--ui-accent)] bg-[var(--ui-accent)] text-white hover:bg-[var(--ui-accent-hover)] disabled:opacity-40"
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button
        type="button"
        title="Next"
        disabled={!hasSegments}
        onClick={onNext}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] text-[var(--ui-text)] hover:border-[var(--ui-accent)] disabled:opacity-40"
      >
        <NextIcon />
      </button>
    </div>
  )
}
