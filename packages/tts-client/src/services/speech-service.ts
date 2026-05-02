import type { TtsEngine } from '../engines/types.js'
import { handleError } from '../error.js'
import type { AudioQuery, PlaybackOptions } from '../types.js'
import { downloadBlob, isBrowser } from '../utils.js'
import type { AudioFileManager } from './file-manager.js'

export interface SpeechServiceConfig {
  defaultSpeaker: number
  defaultSpeedScale: number
  defaultVolumeScale?: number
  defaultPitchScale?: number
  defaultPrePhonemeLength?: number
  defaultPostPhonemeLength?: number
  defaultPlaybackOptions: PlaybackOptions
  maxSegmentLength: number
}

export interface SpeechServiceSpeakOptions extends PlaybackOptions {
  speaker?: number
  speedScale?: number
  pitchScale?: number
  intonationScale?: number
  volumeScale?: number
  prePhonemeLength?: number
  postPhonemeLength?: number
}

export class SpeechService {
  constructor(
    private readonly api: TtsEngine,
    private readonly fileManager: AudioFileManager,
    private readonly config: SpeechServiceConfig
  ) {}

  public async generateQuery(text: string, speaker?: number, speedScale?: number): Promise<AudioQuery> {
    try {
      const speakerId = this.getSpeakerId(speaker)
      const query = await this.api.generateQuery(text, speakerId)
      query.speedScale = this.getSpeedScale(speedScale)

      if (this.config.defaultVolumeScale !== undefined) {
        query.volumeScale = this.config.defaultVolumeScale
      }
      if (this.config.defaultPitchScale !== undefined) {
        query.pitchScale = this.config.defaultPitchScale
      }
      if (this.config.defaultPrePhonemeLength !== undefined) {
        query.prePhonemeLength = this.config.defaultPrePhonemeLength
      }
      if (this.config.defaultPostPhonemeLength !== undefined) {
        query.postPhonemeLength = this.config.defaultPostPhonemeLength
      }

      return query
    } catch (error) {
      throw handleError('クエリ生成中にエラーが発生しました', error)
    }
  }

  public async generateAudioFile(
    textOrQuery: string | AudioQuery,
    outputPath?: string,
    speaker?: number,
    speedScale?: number
  ): Promise<string> {
    try {
      const speakerId = this.getSpeakerId(speaker)
      const speed = this.getSpeedScale(speedScale)

      if (isBrowser()) {
        const filename =
          outputPath ||
          (typeof textOrQuery === 'string'
            ? `voice-${textOrQuery.substring(0, 10).replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.wav`
            : `voice-${Date.now()}.wav`)

        const query =
          typeof textOrQuery === 'string' ? await this.generateQuery(textOrQuery, speakerId) : { ...textOrQuery }
        query.speedScale = speed

        const audioData = await this.api.synthesize(query, speakerId)
        return await downloadBlob(audioData, filename)
      }

      if (typeof textOrQuery === 'string') {
        const query = await this.generateQuery(textOrQuery, speakerId)
        query.speedScale = speed
        const audioData = await this.api.synthesize(query, speakerId)

        if (!outputPath) {
          return await this.fileManager.saveTempAudioFile(audioData)
        }
        return await this.fileManager.saveAudioFile(audioData, outputPath)
      }

      const query = { ...textOrQuery, speedScale: speed }
      const audioData = await this.api.synthesize(query, speakerId)

      if (!outputPath) {
        return await this.fileManager.saveTempAudioFile(audioData)
      }
      return await this.fileManager.saveAudioFile(audioData, outputPath)
    } catch (error) {
      throw handleError('音声ファイル生成中にエラーが発生しました', error)
    }
  }

  private getSpeakerId(speaker?: number): number {
    return speaker ?? this.config.defaultSpeaker
  }

  private getSpeedScale(speedScale?: number): number {
    return speedScale ?? this.config.defaultSpeedScale
  }
}
