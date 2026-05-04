import type { AccentPhrase, AudioQuery, TtsEngine } from '@kajidog/tts-client'
import type { PlayerSettingsStore } from '../player/player-settings-store.js'
import type { VrmRegistryStore } from '../vrm-registry/store.js'

export type SynthesizeResult = {
  audioBase64: string
  text: string
  speaker: number
  speakerName: string
  kana?: string
  audioQuery?: AudioQuery
  accentPhrases?: AccentPhrase[]
  speedScale: number
  intonationScale?: number
  volumeScale?: number
  prePhonemeLength?: number
  postPhonemeLength?: number
  pauseLengthScale?: number
}

export type SpeakerEntry = { id: number; name: string; characterName: string; uuid: string }

export type PlayerSegmentState = {
  text: string
  speaker: number
  speakerName?: string
  kana?: string
  audioQuery?: AudioQuery
  accentPhrases?: AccentPhrase[]
  speedScale: number
  intonationScale?: number
  volumeScale?: number
  prePhonemeLength?: number
  postPhonemeLength?: number
  pauseLengthScale?: number
  pose?: string
}

export type PlayerSessionState = {
  segments: PlayerSegmentState[]
  updatedAt: number
}

export interface PlayerUIShared {
  playerEngine: TtsEngine
  playerResourceUri: string
  synthesizeWithCache: (input: {
    text: string
    speaker: number
    audioQuery?: AudioQuery
    speedScale?: number
    intonationScale?: number
    volumeScale?: number
    prePhonemeLength?: number
    postPhonemeLength?: number
    pauseLengthScale?: number
    accentPhrases?: AccentPhrase[]
  }) => Promise<SynthesizeResult>
  setSessionState: (key: string, state: PlayerSessionState) => void
  getSessionState: (key: string) => PlayerSessionState | undefined
  getSpeakerList: () => Promise<SpeakerEntry[]>
  vrmRegistry: VrmRegistryStore
  playerSettings: PlayerSettingsStore
}
