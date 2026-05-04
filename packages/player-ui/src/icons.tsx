/** Play アイコン SVG */
export function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Play" className="h-5 w-5 fill-current">
      <title>Play</title>
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

/** Pause アイコン SVG */
export function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Pause" className="h-5 w-5 fill-current">
      <title>Pause</title>
      <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
    </svg>
  )
}

/** Speaker アイコン SVG */
export function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Speaker" className="h-5 w-5 fill-current">
      <title>Speaker</title>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
    </svg>
  )
}

/** Equalizer アイコン (再生中インジケーター) */
export function EqualizerIcon() {
  return (
    <div className="equalizer" aria-label="Playing">
      <div className="equalizer-bar" />
      <div className="equalizer-bar" />
      <div className="equalizer-bar" />
    </div>
  )
}

/** Repeat アイコン (連続再生トグル) */
export function RepeatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Repeat" className="h-5 w-5 fill-current">
      <title>Repeat</title>
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
    </svg>
  )
}

/** 次へアイコン */
export function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Next" className="h-5 w-5 fill-current">
      <title>Next</title>
      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
    </svg>
  )
}

/** 前へアイコン */
export function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Previous" className="h-5 w-5 fill-current">
      <title>Previous</title>
      <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
    </svg>
  )
}

/** Chevron Down アイコン */
export function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Expand" className="h-4 w-4 fill-current">
      <title>Expand</title>
      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
    </svg>
  )
}

/** Rewind to Start アイコン */
export function RewindIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Rewind" className="h-5 w-5 fill-current">
      <title>Rewind</title>
      <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
    </svg>
  )
}

/** Info アイコン (詳細トグル) */
export function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Info" className="h-5 w-5 fill-current">
      <title>Info</title>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
    </svg>
  )
}

/** Delete アイコン (トラック削除) */
export function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Delete" className="h-4 w-4 fill-current">
      <title>Delete</title>
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  )
}

/** Drag Handle アイコン (並べ替え) */
export function DragHandleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Drag" className="h-4 w-4 fill-current">
      <title>Drag</title>
      <circle cx="9" cy="5" r="1.5" />
      <circle cx="15" cy="5" r="1.5" />
      <circle cx="9" cy="10" r="1.5" />
      <circle cx="15" cy="10" r="1.5" />
      <circle cx="9" cy="15" r="1.5" />
      <circle cx="15" cy="15" r="1.5" />
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="15" cy="20" r="1.5" />
    </svg>
  )
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Settings" className="h-5 w-5 fill-current">
      <title>Settings</title>
      <path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65-2-3.46-2.49 1a7.3 7.3 0 0 0-1.69-.98L15 3h-4l-.36 2.93c-.6.23-1.17.56-1.69.98l-2.49-1-2 3.46 2.11 1.65c-.05.32-.07.65-.07.98s.02.66.07.98l-2.11 1.65 2 3.46 2.49-1c.52.4 1.08.73 1.69.98L11 21h4l.36-2.93c.61-.24 1.17-.57 1.69-.98l2.49 1 2-3.46-2.11-1.65zM13 15.5A3.5 3.5 0 1 1 13 8a3.5 3.5 0 0 1 0 7.5z" />
    </svg>
  )
}

export function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Fullscreen" className="h-5 w-5 fill-current">
      <title>Fullscreen</title>
      <path d="M5 5h6v2H7v4H5V5zm12 2h-4V5h6v6h-2V7zM7 13v4h4v2H5v-6h2zm12 0v6h-6v-2h4v-4h2z" />
    </svg>
  )
}

export function FullscreenExitIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Exit fullscreen" className="h-5 w-5 fill-current">
      <title>Exit fullscreen</title>
      <path d="M9 9H5V7h2V5h2v4zm10-2v2h-4V5h2v2h2zM7 17H5v-2h4v4H7v-2zm10 0v2h-2v-4h4v2h-2z" />
    </svg>
  )
}

export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Edit" className="h-4 w-4 fill-current">
      <title>Edit</title>
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
    </svg>
  )
}

export function PlusCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Add" className="h-5 w-5 fill-current">
      <title>Add</title>
      <path d="M12 2a10 10 0 1 0 .01 0H12zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
    </svg>
  )
}
