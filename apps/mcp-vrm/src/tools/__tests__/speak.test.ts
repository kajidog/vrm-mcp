import type { AccentPhrase } from '@kajidog/tts-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerSpeakTool } from '../speak.js'
import type { ToolDeps } from '../types.js'

const mockRegisterTool = vi.fn()

const mockTtsClient = {
  generateQuery: vi.fn(),
  enqueueAudioGeneration: vi.fn(),
}

const mockEngine = {
  displayName: 'Mock TTS',
  updateMoraData: vi.fn(),
}

function createMockDeps(): ToolDeps {
  return {
    server: { registerTool: mockRegisterTool } as any,
    ttsClient: mockTtsClient as any,
    engine: mockEngine as any,
    capabilities: {
      audioQuery: true,
      directSpeech: false,
      accentPhrases: true,
      moraData: true,
      userDictionary: true,
      speakerInfo: true,
      speakerList: true,
    },
    config: {
      baseUrl: 'http://localhost:50021',
      defaultSpeaker: 1,
      defaultSpeedScale: 1.0,
      defaultImmediate: true,
      defaultWaitForStart: false,
      defaultWaitForEnd: false,
      restrictImmediate: false,
      restrictWaitForStart: false,
      restrictWaitForEnd: false,
      disabledTools: [],
      httpMode: false,
      httpPort: 3000,
      httpHost: '0.0.0.0',
    } as any,
    disabledTools: new Set<string>(),
    restrictions: {
      immediate: false,
      waitForStart: false,
      waitForEnd: false,
    },
  }
}

function getHandler(toolName: string) {
  const call = mockRegisterTool.mock.calls.find((c: any[]) => c[0] === toolName)
  expect(call).toBeDefined()
  return call![2]
}

function makePhrase(moras: string[], accent: number): AccentPhrase {
  return {
    moras: moras.map((text) => ({ text, vowel: 'a', vowel_length: 0.1, pitch: 5 })),
    accent,
  }
}

describe('registerSpeakTool phrases mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEngine.updateMoraData.mockImplementation(async (accentPhrases: any) => accentPhrases)

    mockTtsClient.generateQuery.mockImplementation(async (text: string) => {
      if (text === 'A、B') {
        return {
          accent_phrases: [makePhrase(['A'], 1), makePhrase(['B'], 1)],
          speedScale: 1,
          kana: text,
        }
      }
      return {
        accent_phrases: [makePhrase(['A', 'B'], 1)],
        speedScale: 1,
        kana: text,
      }
    })

    mockTtsClient.enqueueAudioGeneration.mockImplementation(async (audioQuery: any) => ({
      audioBase64: 'dummy',
      text: 'dummy',
      speaker: 1,
      speakerName: 'Speaker 1',
      speedScale: 1,
      audioQuery,
      accentPhrases: audioQuery.accent_phrases,
    }))
  })

  it('phrasesの各要素を読点区切りでクエリ化し、アクセント句境界を保持する', async () => {
    const deps = createMockDeps()
    registerSpeakTool(deps)
    const handler = getHandler('tts_speak')

    await handler({ text: 'unused', phrases: 'A,B' }, {})

    expect(mockTtsClient.generateQuery).toHaveBeenCalledWith('A、B', 1, undefined)
    const passedQuery = mockTtsClient.enqueueAudioGeneration.mock.calls[0][0]
    expect(passedQuery.accent_phrases).toHaveLength(2)
  })
})
