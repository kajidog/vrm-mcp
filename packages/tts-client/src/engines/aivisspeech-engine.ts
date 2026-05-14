import type { EngineCapabilities, TtsEngineId } from './types.js'
import { VoicevoxEngine } from './voicevox-engine.js'

export const AIVISSPEECH_BASE_URL = 'http://localhost:10101'

// AivisSpeech は VOICEVOX 互換 API を提供するが、audio_query レスポンスの
// mora.consonant_length / vowel_length / pitch は常に 0.0 (ダミー値) となる。
// そのため moraData は false にして、UI 側で音素タイミング駆動のリップシンクを無効化する。
export const aivisspeechCapabilities: EngineCapabilities = {
  audioQuery: true,
  directSpeech: false,
  accentPhrases: true,
  moraData: false,
  userDictionary: true,
  speakerInfo: true,
  speakerList: true,
}

export class AivisSpeechEngine extends VoicevoxEngine {
  public readonly id: TtsEngineId = 'aivisspeech'
  public readonly displayName: string = 'AivisSpeech'
  public readonly capabilities: EngineCapabilities = aivisspeechCapabilities

  constructor(baseUrl = AIVISSPEECH_BASE_URL) {
    super(baseUrl)
  }
}
