import { handleError } from '../error.js'
import type { AccentPhrase, AudioQuery, Speaker, SpeakerInfo, UserDictionaryWord } from '../types.js'
import { HttpClient } from './http-client.js'
import type {
  DictionaryWordInput,
  DictionaryWordUpdateInput,
  DirectSpeechInput,
  EngineCapabilities,
  TtsEngine,
} from './types.js'

export const SAKURA_AI_BASE_URL = 'https://api.ai.sakura.ad.jp'

export const sakuraAiCapabilities: EngineCapabilities = {
  audioQuery: true,
  directSpeech: true,
  accentPhrases: false,
  moraData: false,
  userDictionary: false,
  speakerInfo: false,
  speakerList: true,
}

const sakuraSpeakers: Speaker[] = [
  {
    name: 'ずんだもん',
    speaker_uuid: 'sakuraai-zundamon',
    version: 'sakura-ai',
    supported_features: { permitted_synthesis_morphing: 'NOTHING' },
    styles: [
      { name: 'ノーマル', id: 3, type: 'talk' },
      { name: 'あまあま', id: 1, type: 'talk' },
      { name: 'セクシー', id: 5, type: 'talk' },
      { name: 'つんつん', id: 7, type: 'talk' },
      { name: 'ささやき', id: 22, type: 'talk' },
      { name: 'ヒソヒソ', id: 38, type: 'talk' },
      { name: 'ヘロヘロ', id: 75, type: 'talk' },
      { name: 'なみだめ', id: 76, type: 'talk' },
    ],
  },
  createSingleStyleSpeaker('あんこもん', 113),
  createSingleStyleSpeaker('春日部つむぎ', 8),
  createSingleStyleSpeaker('冥鳴ひまり', 14),
  createSingleStyleSpeaker('四国めたん', 2),
  createSingleStyleSpeaker('東北イタコ', 109),
  createSingleStyleSpeaker('東北きりたん', 108),
  createSingleStyleSpeaker('東北ずん子', 107),
]

export interface SakuraAiEngineOptions {
  baseUrl?: string
  apiKey: string
}

export class SakuraAiEngine implements TtsEngine {
  public readonly id = 'sakuraai'
  public readonly displayName = 'Sakura AI Engine'
  public readonly capabilities = sakuraAiCapabilities
  private readonly http: HttpClient

  constructor(options: SakuraAiEngineOptions) {
    if (!options.apiKey) {
      throw new Error('Sakura AI Engine requires TTS_API_KEY')
    }
    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? SAKURA_AI_BASE_URL,
      defaultHeaders: {
        Authorization: `Bearer ${options.apiKey}`,
      },
    })
  }

  public get baseUrl(): string {
    return this.http.baseUrl
  }

  public async checkHealth(): Promise<{ connected: boolean; url: string }> {
    return { connected: true, url: this.baseUrl }
  }

  public async getSpeakers(): Promise<Speaker[]> {
    return sakuraSpeakers
  }

  public async generateQuery(text: string, speaker = 3): Promise<AudioQuery> {
    try {
      return await this.http.request<AudioQuery>(
        'post',
        `/tts/v1/audio_query?text=${encodeURIComponent(text)}&speaker=${encodeURIComponent(speaker.toString())}`,
        null,
        { 'Content-Type': 'application/json' }
      )
    } catch (error) {
      throw handleError('Sakura AI Engine 音声クエリ生成中にエラーが発生しました', error)
    }
  }

  public async synthesize(query: AudioQuery, speaker = 3): Promise<ArrayBuffer> {
    try {
      return await this.http.request<ArrayBuffer>(
        'post',
        `/tts/v1/synthesis?speaker=${encodeURIComponent(speaker.toString())}`,
        query,
        {
          'Content-Type': 'application/json',
          Accept: 'audio/wav',
        },
        'arraybuffer'
      )
    } catch (error) {
      throw handleError('Sakura AI Engine 音声合成中にエラーが発生しました', error)
    }
  }

  public async synthesizeSpeech(input: DirectSpeechInput): Promise<ArrayBuffer> {
    try {
      return await this.http.request<ArrayBuffer>(
        'post',
        '/v1/audio/speech',
        {
          model: 'zundamon',
          input: input.text,
          voice: 'normal',
          response_format: input.responseFormat ?? 'wav',
        },
        {
          'Content-Type': 'application/json',
          Accept: 'audio/wav',
        },
        'arraybuffer'
      )
    } catch (error) {
      throw handleError('Sakura AI Engine direct speech 合成中にエラーが発生しました', error)
    }
  }

  public async getSpeakerInfo(_uuid: string): Promise<SpeakerInfo> {
    throw unsupported(this.displayName, 'speaker info')
  }

  public async getAccentPhrases(_text: string, _speaker = 3): Promise<AccentPhrase[]> {
    throw unsupported(this.displayName, 'accent phrases')
  }

  public async updateMoraData(_accentPhrases: AccentPhrase[], _speaker: number): Promise<AccentPhrase[]> {
    throw unsupported(this.displayName, 'mora data')
  }

  public async getUserDictionary(): Promise<Record<string, UserDictionaryWord>> {
    throw unsupported(this.displayName, 'user dictionary')
  }

  public async addUserDictionaryWord(_input: DictionaryWordInput): Promise<void> {
    throw unsupported(this.displayName, 'user dictionary')
  }

  public async updateUserDictionaryWord(_input: DictionaryWordUpdateInput): Promise<void> {
    throw unsupported(this.displayName, 'user dictionary')
  }

  public async deleteUserDictionaryWord(_wordUuid: string): Promise<void> {
    throw unsupported(this.displayName, 'user dictionary')
  }
}

function createSingleStyleSpeaker(name: string, id: number): Speaker {
  return {
    name,
    speaker_uuid: `sakuraai-${id}`,
    version: 'sakura-ai',
    supported_features: { permitted_synthesis_morphing: 'NOTHING' },
    styles: [{ name: 'ノーマル', id, type: 'talk' }],
  }
}

function unsupported(engineName: string, feature: string): Error {
  return new Error(`${feature} is not supported by ${engineName}`)
}
