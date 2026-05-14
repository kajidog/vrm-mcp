import { handleError } from '../error.js'
import type { AccentPhrase, AudioQuery, Speaker, SpeakerInfo, UserDictionaryWord } from '../types.js'
import { HttpClient } from './http-client.js'
import type {
  DictionaryWordInput,
  DictionaryWordUpdateInput,
  EngineCapabilities,
  TtsEngine,
  TtsEngineId,
} from './types.js'

export const VOICEVOX_BASE_URL = 'http://localhost:50021'

export const voicevoxCapabilities: EngineCapabilities = {
  audioQuery: true,
  directSpeech: false,
  accentPhrases: true,
  moraData: true,
  userDictionary: true,
  speakerInfo: true,
  speakerList: true,
}

export class VoicevoxEngine implements TtsEngine {
  public readonly id: TtsEngineId = 'voicevox'
  public readonly displayName: string = 'VOICEVOX'
  public readonly capabilities: EngineCapabilities = voicevoxCapabilities
  protected readonly http: HttpClient

  constructor(baseUrl = VOICEVOX_BASE_URL) {
    this.http = new HttpClient({ baseUrl })
  }

  public get baseUrl(): string {
    return this.http.baseUrl
  }

  public async generateQuery(text: string, speaker = 1): Promise<AudioQuery> {
    try {
      return await this.http.request<AudioQuery>(
        'post',
        `/audio_query?text=${encodeURIComponent(text)}&speaker=${encodeURIComponent(speaker.toString())}`,
        null,
        { 'Content-Type': 'application/json' }
      )
    } catch (error) {
      throw handleError('音声クエリ生成中にエラーが発生しました', error)
    }
  }

  public async synthesize(query: AudioQuery, speaker = 1): Promise<ArrayBuffer> {
    try {
      return await this.http.request<ArrayBuffer>(
        'post',
        `/synthesis?speaker=${encodeURIComponent(speaker.toString())}`,
        query,
        {
          'Content-Type': 'application/json',
          Accept: 'audio/wav',
        },
        'arraybuffer'
      )
    } catch (error) {
      throw handleError('音声合成中にエラーが発生しました', error)
    }
  }

  public async generateQueryFromPreset(text: string, presetId: number, coreVersion?: string): Promise<AudioQuery> {
    try {
      let endpoint = `/audio_query_from_preset?text=${encodeURIComponent(text)}&preset_id=${encodeURIComponent(
        presetId.toString()
      )}`
      if (coreVersion) endpoint += `&core_version=${encodeURIComponent(coreVersion)}`
      return await this.http.request<AudioQuery>('post', endpoint, null, { 'Content-Type': 'application/json' })
    } catch (error) {
      throw handleError('プリセットを使用した音声クエリ生成中にエラーが発生しました', error)
    }
  }

  public async getSpeakers(): Promise<Speaker[]> {
    try {
      return await this.http.request<Speaker[]>('get', '/speakers', null, { 'Content-Type': 'application/json' })
    } catch (error) {
      throw handleError('スピーカー一覧取得中にエラーが発生しました', error)
    }
  }

  public async getSpeakerInfo(uuid: string): Promise<SpeakerInfo> {
    try {
      return await this.http.request<SpeakerInfo>(
        'get',
        `/speaker_info?speaker_uuid=${encodeURIComponent(uuid)}`,
        null,
        { 'Content-Type': 'application/json' }
      )
    } catch (error) {
      throw handleError('スピーカー情報取得中にエラーが発生しました', error)
    }
  }

  public async checkHealth(): Promise<{ connected: boolean; version?: string; url: string }> {
    try {
      const version = await this.http.request<string>('get', '/version')
      return { connected: true, version, url: this.baseUrl }
    } catch {
      return { connected: false, url: this.baseUrl }
    }
  }

  public async getAccentPhrases(text: string, speaker = 1): Promise<AccentPhrase[]> {
    try {
      return await this.http.request<AccentPhrase[]>(
        'post',
        `/accent_phrases?text=${encodeURIComponent(text)}&speaker=${encodeURIComponent(speaker.toString())}`,
        null,
        { 'Content-Type': 'application/json' }
      )
    } catch (error) {
      throw handleError('アクセント句取得中にエラーが発生しました', error)
    }
  }

  public async updateMoraData(accentPhrases: AccentPhrase[], speaker: number): Promise<AccentPhrase[]> {
    try {
      return await this.http.request<AccentPhrase[]>(
        'post',
        `/mora_data?speaker=${encodeURIComponent(speaker.toString())}`,
        accentPhrases,
        { 'Content-Type': 'application/json' }
      )
    } catch (error) {
      throw handleError('モーラデータ更新中にエラーが発生しました', error)
    }
  }

  public async getUserDictionary(): Promise<Record<string, UserDictionaryWord>> {
    try {
      return await this.http.request<Record<string, UserDictionaryWord>>('get', '/user_dict')
    } catch (error) {
      throw handleError('ユーザー辞書取得中にエラーが発生しました', error)
    }
  }

  public async addUserDictionaryWord(input: DictionaryWordInput): Promise<void> {
    try {
      const params = this.createDictionaryParams(input)
      await this.http.request<string>('post', `/user_dict_word?${params.toString()}`, null, {}, 'text')
    } catch (error) {
      throw handleError('ユーザー辞書追加中にエラーが発生しました', error)
    }
  }

  public async updateUserDictionaryWord(input: DictionaryWordUpdateInput): Promise<void> {
    try {
      const params = this.createDictionaryParams(input)
      await this.http.request<string>(
        'put',
        `/user_dict_word/${encodeURIComponent(input.wordUuid)}?${params.toString()}`,
        null,
        {},
        'text'
      )
    } catch (error) {
      throw handleError('ユーザー辞書更新中にエラーが発生しました', error)
    }
  }

  public async deleteUserDictionaryWord(wordUuid: string): Promise<void> {
    try {
      await this.http.request<string>('delete', `/user_dict_word/${encodeURIComponent(wordUuid)}`, null, {}, 'text')
    } catch (error) {
      throw handleError('ユーザー辞書削除中にエラーが発生しました', error)
    }
  }

  private createDictionaryParams(input: DictionaryWordInput): URLSearchParams {
    return new URLSearchParams({
      surface: input.surface,
      pronunciation: input.pronunciation,
      accent_type: input.accentType.toString(),
      word_type: input.wordType ?? 'PROPER_NOUN',
      priority: input.priority.toString(),
    })
  }
}
