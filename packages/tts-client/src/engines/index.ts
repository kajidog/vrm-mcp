export * from './types.js'
export * from './http-client.js'
export * from './voicevox-engine.js'
export * from './sakura-ai-engine.js'

import { SAKURA_AI_BASE_URL, SakuraAiEngine } from './sakura-ai-engine.js'
import type { TtsEngine, TtsEngineId } from './types.js'
import { VoicevoxEngine } from './voicevox-engine.js'

export interface CreateEngineOptions {
  engine?: TtsEngineId
  baseUrl?: string
  apiKey?: string
}

export function createEngine(options: CreateEngineOptions = {}): TtsEngine {
  const engine = options.engine ?? 'voicevox'
  if (engine === 'voicevox') {
    return new VoicevoxEngine(options.baseUrl ?? 'http://localhost:50021')
  }
  if (engine === 'sakuraai') {
    return new SakuraAiEngine({
      baseUrl: options.baseUrl ?? SAKURA_AI_BASE_URL,
      apiKey: options.apiKey ?? '',
    })
  }
  throw new Error(`Unknown TTS engine: ${engine}`)
}
