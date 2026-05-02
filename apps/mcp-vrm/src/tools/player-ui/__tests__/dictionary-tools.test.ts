import type { AccentPhrase } from '@kajidog/tts-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolDeps } from '../../types.js'
import { createPlayerUIToolContext } from '../context.js'
import { registerPlayerDictionaryTools } from '../dictionary-tools.js'
import type { PlayerUIShared } from '../types.js'

vi.mock('@modelcontextprotocol/ext-apps/server', () => ({
  registerAppTool: (server: any, name: string, definition: any, handler: any) =>
    server.registerTool(name, definition, handler),
}))

const mockRegisterTool = vi.fn()

const mockTtsClient = {
  getDictionary: vi.fn(),
  addDictionaryWord: vi.fn(),
  updateDictionaryWord: vi.fn(),
  deleteDictionaryWord: vi.fn(),
  getAccentNotation: vi.fn(),
}

const mockShared: PlayerUIShared = {
  playerEngine: {
    updateMoraData: vi.fn(async (accentPhrases: AccentPhrase[]) => accentPhrases),
  } as any,
  playerResourceUri: 'ui://test',
  synthesizeWithCache: vi.fn(async (input: any) => ({
    audioBase64: 'dummy',
    text: input.text,
    speaker: input.speaker,
    speakerName: 'Speaker 1',
    speedScale: input.speedScale,
    accentPhrases: input.accentPhrases,
  })),
  setSessionState: vi.fn(),
  getSessionState: vi.fn(),
  getSpeakerList: vi.fn(async () => [{ id: 1, name: 'Normal', characterName: 'Tester', uuid: 'uuid-1' }]),
}

function createMockDeps(): ToolDeps {
  return {
    server: { registerTool: mockRegisterTool } as any,
    ttsClient: mockTtsClient as any,
    engine: mockShared.playerEngine as any,
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
      autoPlay: true,
      enablePlayerPersist: true,
      playerPersistPath: '.',
      playerPersistDebounceMs: 1000,
      cacheMaxEntries: 100,
      cacheMaxSizeMb: 200,
      enableAudioExport: false,
      defaultOutputDir: '.',
      exportOpenDir: false,
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

describe('registerPlayerDictionaryTools preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTtsClient.getAccentNotation.mockResolvedValue({
      notation: 'テ[ス]ト',
      accentPhrases: [makePhrase(['テ', 'ス', 'ト'], 2)],
    })
  })

  it('accentType指定時はプレビュー音声に同アクセントを反映する', async () => {
    const deps = createMockDeps()
    const context = createPlayerUIToolContext(deps, mockShared)
    registerPlayerDictionaryTools(context)

    const handler = getHandler('_preview_dictionary_word_for_player')
    const result = await handler({ text: 'テスト', accentType: 0 }, {})

    expect(mockShared.playerEngine.updateMoraData).toHaveBeenCalled()
    expect(mockShared.synthesizeWithCache).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'テスト',
        accentPhrases: [expect.objectContaining({ accent: 0 })],
      })
    )

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.accentPhrases[0].accent).toBe(0)
    expect(parsed.notation).toBe('テスト')
  })
})
