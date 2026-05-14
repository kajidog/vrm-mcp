import type { AccentPhrase, AudioQuery } from '@kajidog/tts-client'
import type { TtsEngine } from '@kajidog/tts-client'
import { PoseRegistryStore } from '../pose-registry/store.js'
import type { ToolDeps } from '../types.js'
import { VrmRegistryStore } from '../vrm-registry/store.js'
import { AudioCacheStore, createAudioCacheKey } from './audio-cache.js'
import { getPlayerDictionaryRevision } from './dictionary-revision.js'
import { PlayerSettingsStore } from './player-settings-store.js'
import type { PlayerSessionState } from './session-state.js'
import { SessionStateStore } from './session-state.js'

export const playerResourceUri = 'ui://speak-player/player.html'

type SpeakerEntry = { id: number; name: string; characterName: string; uuid: string }

type SynthesizeInput = {
  userId?: string
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
}

type SynthesizeResult = {
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

export interface PlayerRuntime {
  playerEngine: TtsEngine
  getSpeakerList: () => Promise<SpeakerEntry[]>
  getSpeakerName: (speakerId: number) => Promise<string>
  resolveSpeakerNames: (speakerIds: number[]) => Promise<Map<number, string>>
  getUserDictionaryWords: () => Promise<
    Array<{ wordUuid: string; surface: string; pronunciation: string; accentType: number; priority: number }>
  >
  synthesizeWithCache: (input: SynthesizeInput) => Promise<SynthesizeResult>
  setSessionState: (key: string, state: PlayerSessionState) => void
  getSessionState: (viewUUID: string | undefined, sessionId: string | undefined) => PlayerSessionState | undefined
  getSessionStateByKey: (key: string) => PlayerSessionState | undefined
  vrmRegistry: VrmRegistryStore
  poseRegistry: PoseRegistryStore
  playerSettings: PlayerSettingsStore
}

// ---------------------------------------------------------------------------
// Module-scope singletons (one-time init guard for HTTP mode)
// ---------------------------------------------------------------------------

let audioCacheStore: AudioCacheStore | null = null
let sessionStateStore: SessionStateStore | null = null
let vrmRegistryStore: VrmRegistryStore | null = null
let poseRegistryStore: PoseRegistryStore | null = null
let playerSettingsStore: PlayerSettingsStore | null = null
let speakerCache: SpeakerEntry[] | null = null
const inFlightSyntheses = new Map<string, Promise<SynthesizeResult>>()

type ResolvedSynthesizeInput = Required<Pick<SynthesizeInput, 'text' | 'speaker' | 'speedScale'>> &
  Omit<SynthesizeInput, 'text' | 'speaker' | 'speedScale'>

export function createPlayerRuntime(deps: ToolDeps): PlayerRuntime {
  const { config, engine, capabilities } = deps

  // セッションごとの再登録で初期化が多重実行されないようにする。
  if (!audioCacheStore) {
    audioCacheStore = new AudioCacheStore(config)
  }
  if (!sessionStateStore) {
    sessionStateStore = new SessionStateStore(config, audioCacheStore.getDir())
  }
  if (!vrmRegistryStore) {
    vrmRegistryStore = new VrmRegistryStore({ cacheDir: audioCacheStore.getDir() })
  }
  if (!poseRegistryStore) {
    poseRegistryStore = new PoseRegistryStore({ cacheDir: audioCacheStore.getDir() })
  }
  if (!playerSettingsStore) {
    playerSettingsStore = new PlayerSettingsStore(config)
  }

  const cache = audioCacheStore
  const sessionState = sessionStateStore
  const vrmRegistry = vrmRegistryStore
  const poseRegistry = poseRegistryStore
  const playerSettings = playerSettingsStore
  const playerEngine = engine

  const getSpeakerList = async () => {
    // スピーカー一覧は変化が少ないためプロセス内キャッシュする。
    if (speakerCache) return speakerCache
    try {
      const speakers = await playerEngine.getSpeakers()
      speakerCache = speakers.flatMap((speaker) =>
        speaker.styles.map((style) => ({
          id: style.id,
          name: style.name,
          characterName: speaker.name,
          uuid: speaker.speaker_uuid,
        }))
      )
      return speakerCache
    } catch {
      return []
    }
  }

  const getSpeakerName = async (speakerId: number) => {
    const list = await getSpeakerList()
    const found = list?.find((s) => s.id === speakerId)
    return found ? `${found.characterName}（${found.name}）` : `Speaker ${speakerId}`
  }

  const resolveSpeakerNames = async (speakerIds: number[]) => {
    const uniqueSpeakerIds = [...new Set(speakerIds)]
    const entries = await Promise.all(uniqueSpeakerIds.map(async (id) => [id, await getSpeakerName(id)] as const))
    return new Map<number, string>(entries)
  }

  const getUserDictionaryWords = async () => {
    if (!capabilities.userDictionary) return []
    const dictionary = await playerEngine.getUserDictionary()
    return Object.entries(dictionary).map(([wordUuid, word]) => ({
      wordUuid,
      surface: word.surface,
      pronunciation: word.pronunciation,
      accentType: word.accent_type,
      priority: word.priority,
    }))
  }

  const resolveSynthesisInput = (input: SynthesizeInput): ResolvedSynthesizeInput => {
    return playerSettings.applyDefaults(input, input.userId) as ResolvedSynthesizeInput
  }

  const refreshMoraData = async (resolved: ResolvedSynthesizeInput): Promise<AudioQuery | undefined> => {
    const { audioQuery, accentPhrases, speaker } = resolved
    if (
      !capabilities.moraData ||
      !audioQuery ||
      !accentPhrases ||
      accentPhrases.length === 0 ||
      audioQuery.accent_phrases?.length === 0
    ) {
      return audioQuery
    }
    try {
      const updated = await playerEngine.updateMoraData(accentPhrases, speaker)
      return { ...audioQuery, accent_phrases: updated }
    } catch (e) {
      console.warn('[synthesizeWithCache] /mora_data 再計算失敗、元のピッチ値を使用:', e)
      return audioQuery
    }
  }

  const buildCacheKey = (resolved: ResolvedSynthesizeInput, effectiveAudioQuery?: AudioQuery): string =>
    createAudioCacheKey({
      engineId: playerEngine.id,
      baseUrl: playerEngine.baseUrl,
      text: resolved.text,
      speaker: resolved.speaker,
      audioQuery: effectiveAudioQuery,
      speedScale: resolved.speedScale,
      dictionaryRevision: getPlayerDictionaryRevision(),
      intonationScale: resolved.intonationScale,
      volumeScale: resolved.volumeScale,
      prePhonemeLength: resolved.prePhonemeLength,
      postPhonemeLength: resolved.postPhonemeLength,
      pauseLengthScale: resolved.pauseLengthScale,
      accentPhrases: resolved.accentPhrases,
    })

  const applyQueryOverrides = (query: AudioQuery, resolved: ResolvedSynthesizeInput): AudioQuery => {
    const next = { ...query }
    if (resolved.accentPhrases) next.accent_phrases = resolved.accentPhrases
    next.speedScale = resolved.speedScale
    if (resolved.intonationScale !== undefined) next.intonationScale = resolved.intonationScale
    if (resolved.volumeScale !== undefined) next.volumeScale = resolved.volumeScale
    if (resolved.prePhonemeLength !== undefined) next.prePhonemeLength = resolved.prePhonemeLength
    if (resolved.postPhonemeLength !== undefined) next.postPhonemeLength = resolved.postPhonemeLength
    if (resolved.pauseLengthScale !== undefined) next.pauseLengthScale = resolved.pauseLengthScale
    return next
  }

  const resultFromCache = async (
    resolved: ResolvedSynthesizeInput,
    speakerName: string,
    cachedBase64: string,
    effectiveAudioQuery?: AudioQuery
  ): Promise<SynthesizeResult> => {
    const cachedQuery =
      effectiveAudioQuery ??
      applyQueryOverrides(await playerEngine.generateQuery(resolved.text, resolved.speaker), resolved)
    return {
      audioBase64: cachedBase64,
      text: resolved.text,
      speaker: resolved.speaker,
      speakerName,
      kana: cachedQuery.kana,
      audioQuery: cachedQuery,
      speedScale: cachedQuery.speedScale ?? resolved.speedScale,
      intonationScale: cachedQuery.intonationScale ?? resolved.intonationScale,
      volumeScale: cachedQuery.volumeScale ?? resolved.volumeScale,
      prePhonemeLength: cachedQuery.prePhonemeLength ?? resolved.prePhonemeLength,
      postPhonemeLength: cachedQuery.postPhonemeLength ?? resolved.postPhonemeLength,
      pauseLengthScale: cachedQuery.pauseLengthScale ?? resolved.pauseLengthScale,
      accentPhrases: (cachedQuery.accent_phrases as AccentPhrase[] | undefined) ?? resolved.accentPhrases,
    }
  }

  const synthesizeAndStore = async (
    resolved: ResolvedSynthesizeInput,
    speakerName: string,
    cacheKey: string,
    effectiveAudioQuery?: AudioQuery
  ): Promise<SynthesizeResult> => {
    const resolvedQuery = effectiveAudioQuery
      ? { ...effectiveAudioQuery }
      : applyQueryOverrides(await playerEngine.generateQuery(resolved.text, resolved.speaker), resolved)
    const audioData = await playerEngine.synthesize(resolvedQuery, resolved.speaker)
    const base64Audio = Buffer.from(audioData).toString('base64')
    await cache.writeCachedBase64(cacheKey, base64Audio)
    return {
      audioBase64: base64Audio,
      text: resolved.text,
      speaker: resolved.speaker,
      speakerName,
      kana: resolvedQuery.kana,
      audioQuery: resolvedQuery,
      accentPhrases: resolvedQuery.accent_phrases as AccentPhrase[] | undefined,
      speedScale: resolvedQuery.speedScale,
      intonationScale: resolvedQuery.intonationScale,
      volumeScale: resolvedQuery.volumeScale,
      prePhonemeLength: resolvedQuery.prePhonemeLength,
      postPhonemeLength: resolvedQuery.postPhonemeLength,
      pauseLengthScale: resolvedQuery.pauseLengthScale,
    }
  }

  const synthesizeWithCache = async (input: SynthesizeInput): Promise<SynthesizeResult> => {
    const resolved = resolveSynthesisInput(input)
    const speakerName = await getSpeakerName(resolved.speaker)
    const effectiveAudioQuery = await refreshMoraData(resolved)
    const cacheKey = buildCacheKey(resolved, effectiveAudioQuery)
    const cachedBase64 = cache.readCachedBase64(cacheKey)
    if (cachedBase64) {
      return resultFromCache(resolved, speakerName, cachedBase64, effectiveAudioQuery)
    }

    const inFlight = inFlightSyntheses.get(cacheKey)
    if (inFlight) return inFlight

    const pending = synthesizeAndStore(resolved, speakerName, cacheKey, effectiveAudioQuery).finally(() => {
      inFlightSyntheses.delete(cacheKey)
    })
    inFlightSyntheses.set(cacheKey, pending)
    return pending
  }

  return {
    playerEngine,
    getSpeakerList,
    getSpeakerName,
    resolveSpeakerNames,
    getUserDictionaryWords,
    synthesizeWithCache,
    setSessionState: (key, state) => sessionState.set(key, state),
    getSessionState: (viewUUID, sessionId) => sessionState.get(viewUUID, sessionId),
    getSessionStateByKey: (key) => sessionState.getByKey(key),
    vrmRegistry,
    poseRegistry,
    playerSettings,
  }
}

export function getPlayerRuntimeStores(): Pick<
  PlayerRuntime,
  'vrmRegistry' | 'poseRegistry' | 'playerSettings'
> | null {
  if (!vrmRegistryStore || !poseRegistryStore || !playerSettingsStore) return null
  return {
    vrmRegistry: vrmRegistryStore,
    poseRegistry: poseRegistryStore,
    playerSettings: playerSettingsStore,
  }
}
