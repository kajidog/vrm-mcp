import { useEffect, useRef } from 'react'
import type { AudioQuery } from '~/types'
import type { PoseSegment } from '../utils/vrmPayload'

/** VRM の母音表情チャネル。`@pixiv/three-vrm` の expression プリセット名に対応。 */
export interface MouthValues {
  aa: number
  ih: number
  ou: number
  ee: number
  oh: number
}

export type MouthRef = { current: MouthValues }

export interface LipSyncController {
  /** VRMScene が毎フレーム読み取る。値は in-place 更新される。 */
  mouthRef: MouthRef
  /** audio 要素の生成タイミングで 1 回だけ呼ぶ。AudioContext と AnalyserNode を構築する。 */
  attachAudio: (audio: HTMLAudioElement) => void
  /** セグメント切替時に呼ぶ。null を渡すと口は閉じへ減衰する。 */
  setSegment: (segment: PoseSegment | null) => void
  /** ユーザー操作起源の play() 直前に呼ぶ。autoplay policy 対策。 */
  resumeContext: () => void
  /** unmount 時に呼ぶ。RAF と AudioContext を解放する。 */
  dispose: () => void
}

type Mode = 'idle' | 'mora' | 'analyser'

type VowelKey = 'aa' | 'ih' | 'ou' | 'ee' | 'oh' | 'N' | 'silent'

interface MoraEvent {
  start: number
  end: number
  vowel: VowelKey
}

const VOWEL_MAP: Record<string, VowelKey> = {
  a: 'aa',
  A: 'aa',
  i: 'ih',
  I: 'ih',
  u: 'ou',
  U: 'ou',
  e: 'ee',
  E: 'ee',
  o: 'oh',
  O: 'oh',
  N: 'N',
}

function mapVowel(raw: string | undefined | null): VowelKey {
  if (!raw) return 'silent'
  return VOWEL_MAP[raw] ?? 'silent'
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function buildTimeline(query: AudioQuery): MoraEvent[] {
  const events: MoraEvent[] = []
  const speed = query.speedScale && query.speedScale > 0 ? query.speedScale : 1
  let t = (query.prePhonemeLength ?? 0) / speed
  for (const phrase of query.accent_phrases ?? []) {
    for (const mora of phrase.moras ?? []) {
      if (typeof mora.consonant_length === 'number' && Number.isFinite(mora.consonant_length)) {
        t += mora.consonant_length / speed
      }
      const dur = (mora.vowel_length ?? 0) / speed
      if (dur > 0) {
        events.push({ start: t, end: t + dur, vowel: mapVowel(mora.vowel) })
        t += dur
      }
    }
    const pause = phrase.pause_mora
    if (pause && typeof pause.vowel_length === 'number') {
      t += pause.vowel_length / speed
    }
  }
  return events
}

/**
 * 二分探索で `now` を含む（または直前の）イベント index を返す。該当無しは -1。
 * `hint` を起点にした最適化はしない（モーラ数は数百以下なので二分探索で十分速い）。
 */
function findEventIndex(events: MoraEvent[], now: number): number {
  if (events.length === 0) return -1
  let lo = 0
  let hi = events.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const ev = events[mid]
    if (now < ev.start) hi = mid - 1
    else if (now >= ev.end) lo = mid + 1
    else return mid
  }
  return -1
}

const ATTACK = 0.35
const RELEASE = 0.18
const N_PLATEAU = 0.15
const VOWEL_PEAK = 0.9

export function useLipSync(): LipSyncController {
  const mouthRef = useRef<MouthValues>({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 })
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const analyserBufRef = useRef<Uint8Array | null>(null)
  const modeRef = useRef<Mode>('idle')
  const timelineRef = useRef<MoraEvent[]>([])
  const rafRef = useRef<number | null>(null)
  const disposedRef = useRef(false)

  const tick = () => {
    if (disposedRef.current) return
    const audio = audioRef.current
    const target: MouthValues = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }

    if (modeRef.current === 'mora' && audio) {
      const now = audio.currentTime
      const idx = findEventIndex(timelineRef.current, now)
      if (idx >= 0) {
        const ev = timelineRef.current[idx]
        const span = ev.end - ev.start
        const progress = span > 0 ? (now - ev.start) / span : 0
        const intensity = Math.sin(progress * Math.PI) * VOWEL_PEAK
        switch (ev.vowel) {
          case 'aa':
            target.aa = intensity
            break
          case 'ih':
            target.ih = intensity
            break
          case 'ou':
            target.ou = intensity
            break
          case 'ee':
            target.ee = intensity
            break
          case 'oh':
            target.oh = intensity
            break
          case 'N':
            target.aa = N_PLATEAU
            break
          case 'silent':
            break
        }
      }
    } else if (modeRef.current === 'analyser' && audio && analyserRef.current && analyserBufRef.current) {
      const analyser = analyserRef.current
      const buf = analyserBufRef.current
      analyser.getByteTimeDomainData(buf)
      let sumSq = 0
      for (let i = 0; i < buf.length; i += 1) {
        const v = (buf[i] - 128) / 128
        sumSq += v * v
      }
      const rms = Math.sqrt(sumSq / buf.length)
      target.aa = clamp01((rms - 0.02) * 4)
    }

    const m = mouthRef.current
    const channels: (keyof MouthValues)[] = ['aa', 'ih', 'ou', 'ee', 'oh']
    for (const ch of channels) {
      const cur = m[ch]
      const tgt = target[ch]
      const k = cur < tgt ? ATTACK : RELEASE
      m[ch] = cur + (tgt - cur) * k
      if (Math.abs(m[ch]) < 1e-4) m[ch] = 0
    }

    rafRef.current = requestAnimationFrame(tick)
  }

  const ensureLoop = () => {
    if (rafRef.current === null && !disposedRef.current) {
      rafRef.current = requestAnimationFrame(tick)
    }
  }

  const attachAudio = (audio: HTMLAudioElement) => {
    audioRef.current = audio
    if (audioCtxRef.current) {
      ensureLoop()
      return
    }
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      const source = ctx.createMediaElementSource(audio)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.5
      source.connect(analyser)
      // 解析だけして音は止めないように destination にも繋ぐ。
      source.connect(ctx.destination)
      audioCtxRef.current = ctx
      sourceNodeRef.current = source
      analyserRef.current = analyser
      analyserBufRef.current = new Uint8Array(analyser.fftSize)
    } catch (error) {
      console.warn('[useLipSync] AudioContext setup failed:', error)
    }
    ensureLoop()
  }

  const setSegment = (segment: PoseSegment | null) => {
    if (!segment) {
      modeRef.current = 'idle'
      timelineRef.current = []
      return
    }
    if (segment.audioQuery) {
      timelineRef.current = buildTimeline(segment.audioQuery)
      modeRef.current = timelineRef.current.length > 0 ? 'mora' : 'analyser'
    } else {
      timelineRef.current = []
      modeRef.current = 'analyser'
    }
    ensureLoop()
  }

  const resumeContext = () => {
    const ctx = audioCtxRef.current
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        // autoplay policy で失敗した場合は次のジェスチャで再試行されるので無視。
      })
    }
  }

  const dispose = () => {
    disposedRef.current = true
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const ctx = audioCtxRef.current
    if (ctx) {
      ctx.close().catch(() => {
        // 既に閉じている場合のエラーは無視。
      })
    }
    audioCtxRef.current = null
    sourceNodeRef.current = null
    analyserRef.current = null
    analyserBufRef.current = null
    audioRef.current = null
  }

  // React 18 StrictMode の二重 mount で dispose 済みフラグが残らないようにリセットする。
  useEffect(() => {
    disposedRef.current = false
    return () => {
      // 親 effect の cleanup から dispose() が呼ばれるが、保険として停止。
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  // useRef を直接返すため毎レンダで同一インスタンスになる。
  const controllerRef = useRef<LipSyncController | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = {
      mouthRef,
      attachAudio,
      setSegment,
      resumeContext,
      dispose,
    }
  }
  return controllerRef.current
}
