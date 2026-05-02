import type { AccentPhrase, AudioQuery, Speaker, SpeakerInfo, UserDictionaryWord } from '../types.js'

export type TtsEngineId = 'voicevox' | 'sakuraai' | (string & {})

export interface EngineCapabilities {
  audioQuery: boolean
  directSpeech: boolean
  accentPhrases: boolean
  moraData: boolean
  userDictionary: boolean
  speakerInfo: boolean
  speakerList: boolean
}

export interface TtsHealth {
  connected: boolean
  version?: string
  url: string
}

export interface DirectSpeechInput {
  text: string
  speaker: number
  speedScale?: number
  responseFormat?: 'wav'
}

export interface DictionaryWordInput {
  surface: string
  pronunciation: string
  accentType: number
  priority: number
  wordType?: string
}

export interface DictionaryWordUpdateInput extends DictionaryWordInput {
  wordUuid: string
}

export interface TtsEngine {
  readonly id: TtsEngineId
  readonly displayName: string
  readonly baseUrl: string
  readonly capabilities: EngineCapabilities

  checkHealth(): Promise<TtsHealth>
  getSpeakers(): Promise<Speaker[]>
  generateQuery(text: string, speaker?: number): Promise<AudioQuery>
  synthesize(query: AudioQuery, speaker?: number): Promise<ArrayBuffer>

  synthesizeSpeech?(input: DirectSpeechInput): Promise<ArrayBuffer>
  getSpeakerInfo(uuid: string): Promise<SpeakerInfo>
  getAccentPhrases(text: string, speaker?: number): Promise<AccentPhrase[]>
  updateMoraData(accentPhrases: AccentPhrase[], speaker: number): Promise<AccentPhrase[]>
  getUserDictionary(): Promise<Record<string, UserDictionaryWord>>
  addUserDictionaryWord(input: DictionaryWordInput): Promise<void>
  updateUserDictionaryWord(input: DictionaryWordUpdateInput): Promise<void>
  deleteUserDictionaryWord(wordUuid: string): Promise<void>
}

export function assertCapability(engine: TtsEngine, capability: keyof EngineCapabilities, featureLabel: string): void {
  if (!engine.capabilities[capability]) {
    throw new Error(`${featureLabel} is not supported by ${engine.displayName}`)
  }
}
