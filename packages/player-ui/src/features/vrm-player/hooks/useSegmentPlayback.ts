import { useEffect, useRef, useState } from 'react'
import type { PoseSource } from '~/features/poses/types'
import type { VrmPlayerState } from '../types'
import type { PoseSegment } from '../utils/vrmPayload'
import type { LipSyncController } from './useLipSync'

interface UseSegmentPlaybackOptions {
  lipSync: LipSyncController
  resolvePose: (poseName: string | undefined) => PoseSource | null
  resolveExpression: (segment: PoseSegment | null) => VrmPlayerState['expression']
  onError: (message: string) => void
}

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }))
}

export function useSegmentPlayback({ lipSync, resolvePose, resolveExpression, onError }: UseSegmentPlaybackOptions) {
  const [pose, setPose] = useState<PoseSource | null>(null)
  const [expression, setExpression] = useState<VrmPlayerState['expression']>(null)
  const [segments, setSegments] = useState<PoseSegment[]>([])
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState<number | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [paused, setPaused] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  const segmentsRef = useRef<PoseSegment[]>([])
  const playbackIndexRef = useRef(0)
  const playbackVersionRef = useRef(0)

  const releaseAudioUrl = () => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
  }

  const stopPlayback = () => {
    setPaused(false)
    const audio = audioRef.current
    if (audio) {
      audio.onended = null
      audio.onerror = null
      try {
        audio.pause()
      } catch {
        // 既に再生していなくてもエラーにしない。
      }
      audio.removeAttribute('src')
      audio.load()
    }
    releaseAudioUrl()
    lipSync.setSegment(null)
    setCurrentTime(0)
    setDuration(0)
    setExpression(null)
    setCurrentSegmentIndex(null)
  }

  const failPlayback = (message: string) => {
    const list = segmentsRef.current
    stopPlayback()
    segmentsRef.current = list
    setSegments(list)
    setPose(resolvePose('idle'))
    onError(message)
  }

  const playSegmentAt = (index: number, version: number): void => {
    if (version !== playbackVersionRef.current) return
    setPaused(false)
    const list = segmentsRef.current
    const current = list[index]
    if (!current) {
      playbackIndexRef.current = list.length
      setCurrentSegmentIndex(null)
      setPose(resolvePose('idle'))
      setExpression(null)
      return
    }

    playbackIndexRef.current = index
    setCurrentSegmentIndex(index)
    setCurrentTime(0)
    setDuration(0)
    setPose(resolvePose(current.pose ?? 'idle'))
    setExpression(resolveExpression(current))

    const audio = audioRef.current
    releaseAudioUrl()

    if (!audio) {
      failPlayback('音声プレイヤーの初期化に失敗しました。')
      return
    }
    if (!current.audioBase64) {
      failPlayback(`セグメント ${index + 1} の音声データがありません。`)
      return
    }

    const url = base64ToBlobUrl(current.audioBase64, current.audioMimeType ?? 'audio/wav')
    audioUrlRef.current = url
    audio.src = url
    audio.onended = () => {
      if (version !== playbackVersionRef.current) return
      setCurrentTime(Number.isFinite(audio.duration) ? audio.duration : 0)
      playSegmentAt(index + 1, version)
    }
    audio.onerror = () => {
      if (version !== playbackVersionRef.current) return
      failPlayback(`セグメント ${index + 1} の音声を読み込めませんでした。`)
    }
    lipSync.setSegment(current)
    lipSync.resumeContext()
    void audio.play().catch((error) => {
      if (version !== playbackVersionRef.current) return
      failPlayback(`音声の再生に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  const startPlayback = (next: PoseSegment[], options: { autoPlay?: boolean } = {}) => {
    stopPlayback()
    segmentsRef.current = next
    setSegments(next)
    playbackVersionRef.current += 1
    if (next.length === 0) {
      playbackIndexRef.current = 0
      setCurrentSegmentIndex(null)
      setPose(null)
      setExpression(null)
      return
    }
    if (options.autoPlay === false) {
      playbackIndexRef.current = 0
      setCurrentSegmentIndex(null)
      setPose(resolvePose('idle'))
      setExpression(null)
      return
    }
    playSegmentAt(0, playbackVersionRef.current)
  }

  const play = () => {
    const list = segmentsRef.current
    if (list.length === 0) return

    if (paused) {
      setPaused(false)
      const audio = audioRef.current
      if (audio?.src && audio.paused && currentSegmentIndex !== null) {
        lipSync.setSegment(list[currentSegmentIndex] ?? null)
        lipSync.resumeContext()
        void audio.play().catch((error) => {
          failPlayback(`音声の再生に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
        })
        return
      }
    }

    if (currentSegmentIndex === null) {
      startPlayback(list)
    }
  }

  const pause = () => {
    if (currentSegmentIndex === null || paused) return
    const audio = audioRef.current
    if (audio?.src && !audio.paused) {
      audio.pause()
      lipSync.setSegment(null)
      setPaused(true)
    }
  }

  const jumpTo = (index: number) => {
    const list = segmentsRef.current
    if (list.length === 0) return
    stopPlayback()
    playbackVersionRef.current += 1
    segmentsRef.current = list
    setSegments(list)
    playSegmentAt(Math.min(Math.max(index, 0), list.length - 1), playbackVersionRef.current)
  }

  const prev = () => {
    const current = currentSegmentIndex ?? playbackIndexRef.current
    jumpTo(current - 1)
  }

  const next = () => {
    const current = currentSegmentIndex ?? -1
    jumpTo(current + 1)
  }

  const clearSegments = () => {
    stopPlayback()
    segmentsRef.current = []
    setSegments([])
    setCurrentSegmentIndex(null)
    setPose(null)
  }

  const refreshCurrentVisuals = () => {
    const currentSegment = currentSegmentIndex !== null ? segmentsRef.current[currentSegmentIndex] : null
    setPose(resolvePose(currentSegment?.pose ?? 'idle'))
    setExpression(resolveExpression(currentSegment))
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: stopPlayback uses refs only and is stable across renders
  useEffect(() => {
    const audio = new Audio()
    const updateTime = () => setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0)
    const updateDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    audio.addEventListener('timeupdate', updateTime)
    audio.addEventListener('loadedmetadata', updateDuration)
    audioRef.current = audio
    lipSync.attachAudio(audio)
    return () => {
      stopPlayback()
      audio.removeEventListener('timeupdate', updateTime)
      audio.removeEventListener('loadedmetadata', updateDuration)
      audioRef.current = null
      lipSync.dispose()
    }
  }, [])

  return {
    pose,
    expression,
    segments,
    segmentsRef,
    currentSegmentIndex,
    currentTime,
    duration,
    isPlaying: currentSegmentIndex !== null && !paused,
    canReplay: currentSegmentIndex === null && segments.length > 0,
    hasSegments: segments.length > 0,
    currentSegmentText: currentSegmentIndex !== null ? (segments[currentSegmentIndex]?.text ?? null) : null,
    startPlayback,
    stopPlayback,
    clearSegments,
    refreshCurrentVisuals,
    play,
    pause,
    prev,
    next,
  }
}
