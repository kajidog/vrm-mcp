import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolDeps } from '../../types'
import { registerPlayerUITools } from '../index'
import type { PlayerUIShared } from '../types'

vi.mock('@modelcontextprotocol/ext-apps/server', () => ({
  registerAppTool: (server: any, name: string, definition: any, handler: any) =>
    server.registerTool(name, definition, handler),
}))

const mockRegisterTool = vi.fn()

function makeDeps(): ToolDeps {
  return {
    server: { registerTool: mockRegisterTool } as any,
    ttsClient: {} as any,
    engine: {} as any,
    capabilities: {
      audioQuery: true,
      directSpeech: true,
      accentPhrases: false,
      moraData: false,
      userDictionary: false,
      speakerInfo: false,
      speakerList: true,
    },
    config: {
      playerExportEnabled: false,
    } as any,
    disabledTools: new Set(),
    restrictions: { immediate: false, waitForStart: false, waitForEnd: false },
  }
}

function makeShared(): PlayerUIShared {
  return {
    playerEngine: {} as any,
    playerResourceUri: 'ui://test',
    synthesizeWithCache: vi.fn(),
    setSessionState: vi.fn(),
    getSessionState: vi.fn(),
    getSpeakerList: vi.fn(),
  }
}

describe('registerPlayerUITools capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('userDictionary と speakerInfo が未対応なら該当UIツールを登録しない', () => {
    registerPlayerUITools(makeDeps(), makeShared())

    const toolNames = mockRegisterTool.mock.calls.map((call: any[]) => call[0])
    expect(toolNames).not.toContain('_get_speakers_for_player')
    expect(toolNames).not.toContain('_get_speaker_icon_for_player')
    expect(toolNames).not.toContain('_preview_dictionary_word_for_player')
    expect(toolNames).not.toContain('_add_dictionary_word_for_player')
  })
})
