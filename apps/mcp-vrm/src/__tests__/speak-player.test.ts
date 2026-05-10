import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServerConfig } from '../config.js'
import type { PlayerRuntime } from '../tools/player/runtime.js'
import type { PlayerSessionState } from '../tools/player/session-state.js'
import { registerSpeakPlayerTool } from '../tools/player/speak-player-tool.js'
import { PoseRegistryStore } from '../tools/pose-registry/store.js'
import { VrmRegistryStore } from '../tools/vrm-registry/store.js'

const TMP = join(process.cwd(), '__test_speak_player_tmp__')

const SAMPLE_VRM_BYTES = Buffer.from([
  0x67,
  0x6c,
  0x54,
  0x46, // glTF
  0x02,
  0x00,
  0x00,
  0x00, // version 2
  0x0c,
  0x00,
  0x00,
  0x00, // length
])
const SAMPLE_VRM_BASE64 = SAMPLE_VRM_BYTES.toString('base64')

interface CapturedRegistration {
  name: string
  config: Record<string, unknown>
  handler: (args: Record<string, unknown>, extra: { sessionId?: string }) => Promise<CallToolResult>
}

function buildHarness(
  registry: VrmRegistryStore,
  options: { synthesizeWithCache?: PlayerRuntime['synthesizeWithCache'] } = {}
) {
  const registrations: CapturedRegistration[] = []
  const server = {
    registerTool: (name: string, config: Record<string, unknown>, handler: CapturedRegistration['handler']) => {
      registrations.push({ name, config, handler })
    },
  } as unknown as Parameters<typeof registerSpeakPlayerTool>[0]['server']

  const config = {
    httpHost: 'localhost',
    httpPort: 8765,
    autoPlay: true,
    defaultSpeaker: 1,
    defaultSpeedScale: 1.0,
    playerDefaultVrmPath: '',
  } as unknown as ServerConfig

  const sessionStates = new Map<string, PlayerSessionState>()
  const runtime: PlayerRuntime = {
    playerEngine: {} as PlayerRuntime['playerEngine'],
    getSpeakerList: async () => [],
    getSpeakerName: async (id) => `Speaker ${id}`,
    resolveSpeakerNames: async (speakerIds) => {
      const map = new Map<number, string>()
      for (const id of new Set(speakerIds)) map.set(id, `Speaker ${id}`)
      return map
    },
    getUserDictionaryWords: async () => [],
    synthesizeWithCache:
      options.synthesizeWithCache ??
      (async ({ text, speaker, speedScale }) => ({
        audioBase64: `audio-for-${speaker}-${text}`,
        text,
        speaker,
        speakerName: `Speaker ${speaker}`,
        speedScale,
      })),
    setSessionState: (key, state) => sessionStates.set(key, state),
    getSessionState: (viewUUID, sessionId) => sessionStates.get(viewUUID ?? sessionId ?? 'global'),
    getSessionStateByKey: (key) => sessionStates.get(key),
    vrmRegistry: registry,
    poseRegistry: new PoseRegistryStore({ cacheDir: TMP }),
    playerSettings: {
      applyDefaults: (input: Record<string, unknown>) => ({ ...input, speedScale: 1, autoPlay: true }),
    } as PlayerRuntime['playerSettings'],
  }

  registerSpeakPlayerTool(
    {
      server,
      ttsClient: {} as never,
      engine: { id: 'voicevox', displayName: 'VOICEVOX' } as PlayerRuntime['playerEngine'],
      capabilities: {} as never,
      config,
      disabledTools: new Set(),
    },
    runtime
  )

  const registration = registrations.find((r) => r.name.endsWith('speak_player'))
  if (!registration) throw new Error('speak_player was not registered')

  return {
    sessionStates,
    invoke: (args: Record<string, unknown>, extra: { sessionId?: string } = {}) => registration.handler(args, extra),
  }
}

describe('speak_player Phase 5', () => {
  let registry: VrmRegistryStore

  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    registry = new VrmRegistryStore({ cacheDir: TMP })
  })

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  it('modelId + segments を受け取ると vrmModel と pose 付き segments が返る', async () => {
    const model = await registry.register({ name: 'Alice', speakerId: 7, vrmBase64: SAMPLE_VRM_BASE64 })
    const harness = buildHarness(registry)

    const result = await harness.invoke({
      modelId: model.id,
      segments: [
        { pose: 'wave', text: 'Hi' },
        { pose: 'bow', text: 'Bye' },
      ],
    })

    expect(result.isError).toBeUndefined()
    const structured = result.structuredContent as {
      vrmModel?: {
        id: string
        name: string
        speakerId: number
        vrmUrl: string
        emotionBindings: unknown[]
        poses: Array<{ id: string; name: string; loop: boolean }>
      }
      segments: Array<{ text: string; speaker: number; pose?: string; speedScale: number }>
    }
    expect(structured.vrmModel).toEqual({
      id: model.id,
      name: 'Alice',
      speakerId: 7,
      vrmUrl: `http://localhost:8765/vrms/${model.id}.vrm`,
      emotionBindings: [],
      poses: [
        { id: 'builtin:idle', name: 'idle', loop: true },
        { id: 'builtin:neutral', name: 'neutral', loop: true },
        { id: 'builtin:wave', name: 'wave', loop: true },
        { id: 'builtin:bow', name: 'bow', loop: true },
        { id: 'builtin:point', name: 'point', loop: true },
        { id: 'builtin:think', name: 'think', loop: true },
        { id: 'builtin:cheer', name: 'cheer', loop: true },
      ],
    })
    expect(structured.segments).toHaveLength(2)
    expect(structured.segments[0]).toMatchObject({ text: 'Hi', pose: 'wave', speaker: 7 })
    expect(structured.segments[1]).toMatchObject({ text: 'Bye', pose: 'bow', speaker: 7 })
  })

  it('modelId 未指定なら登録済みデフォルト VRM を使う', async () => {
    const model = await registry.register({
      name: 'Default',
      speakerId: 3,
      isDefault: true,
      vrmBase64: SAMPLE_VRM_BASE64,
    })
    const harness = buildHarness(registry)

    const result = await harness.invoke({
      segments: [{ text: 'hello' }],
    })

    expect(result.isError).toBeUndefined()
    const structured = result.structuredContent as {
      resolvedModelId?: string
      vrmModel?: { id: string }
      segments: Array<{ speaker: number }>
    }
    expect(structured.resolvedModelId).toBe(model.id)
    expect(structured.vrmModel?.id).toBe(model.id)
    expect(structured.segments[0].speaker).toBe(3)
  })

  it('segments 指定でデフォルトも未登録ならモデル登録 UI 表示を返す', async () => {
    const harness = buildHarness(registry)

    const result = await harness.invoke({
      segments: [{ text: 'hello' }],
    })

    expect(result.isError).toBeUndefined()
    const structured = result.structuredContent as {
      action?: string
      mode?: string
      displayed?: boolean
      registrationGuide?: string
    }
    expect(structured).toMatchObject({ action: 'openModelManager', mode: 'register', displayed: true })
    expect(structured.registrationGuide).toMatch(/No VRM model is registered/)
  })

  it('未登録の modelId はエラー', async () => {
    const harness = buildHarness(registry)

    const result = await harness.invoke({
      modelId: 'does-not-exist',
      segments: [{ text: 'x' }],
    })

    expect(result.isError).toBe(true)
    const text = (result.content?.[0] as { type: 'text'; text: string }).text
    expect(text).toMatch(/VRM model not found/)
  })

  it('結果に vrmBase64 / thumbnailBase64 / audioBase64 は含めない（UI 側がツール経由で取得）', async () => {
    const model = await registry.register({ name: 'Alice', speakerId: 1, vrmBase64: SAMPLE_VRM_BASE64 })
    const harness = buildHarness(registry)

    const result = await harness.invoke({
      modelId: model.id,
      segments: [{ text: 'Hi' }, { text: 'There' }],
    })

    const json = JSON.stringify(result)
    expect(json).not.toContain('vrmBase64')
    expect(json).not.toContain('thumbnailBase64')
    expect(json).not.toContain('audioBase64')
    // 1MB 制限に引っかからないよう、結果は十分軽量であること。
    expect(Buffer.byteLength(json, 'utf-8')).toBeLessThan(1024 * 1024)
  })

  it('音声合成に失敗したら再生可能な成功レスポンスにしない', async () => {
    const model = await registry.register({ name: 'Alice', speakerId: 1, vrmBase64: SAMPLE_VRM_BASE64 })
    const harness = buildHarness(registry, {
      synthesizeWithCache: async () => {
        throw new Error('VOICEVOX unavailable')
      },
    })

    const result = await harness.invoke({
      modelId: model.id,
      segments: [{ text: 'Hi' }],
    })

    expect(result.isError).toBe(true)
    const text = (result.content?.[0] as { type: 'text'; text: string }).text
    expect(text).toContain('VOICEVOX unavailable')
    expect(result.structuredContent).toBeUndefined()
  })

  it('全セグメントの speaker はモデル登録時の speakerId に統一される', async () => {
    const model = await registry.register({ name: 'A', speakerId: 42, vrmBase64: SAMPLE_VRM_BASE64 })
    const harness = buildHarness(registry)

    const result = await harness.invoke({
      modelId: model.id,
      segments: [{ text: 'a' }, { text: 'b' }, { text: 'c' }],
    })

    expect(result.isError).toBeUndefined()
    const structured = result.structuredContent as { segments: Array<{ speaker: number }> }
    expect(structured.segments.map((s) => s.speaker)).toEqual([42, 42, 42])
  })

  it('emotion binding の speaker と expression をセグメントへ反映する', async () => {
    const model = await registry.register({
      name: 'A',
      speakerId: 1,
      emotionBindings: [
        { emotion: 'happy', speakerId: 8, expressionName: 'happy', weight: 0.7 },
        { emotion: 'sad', speakerId: 9, expressionName: 'sad' },
      ],
      vrmBase64: SAMPLE_VRM_BASE64,
    })
    const harness = buildHarness(registry)

    const result = await harness.invoke({
      modelId: model.id,
      segments: [{ emotion: 'happy', text: 'yay' }, { emotion: 'sad', text: 'oh' }, { text: 'plain' }],
    })

    expect(result.isError).toBeUndefined()
    const structured = result.structuredContent as {
      vrmModel?: { emotionBindings?: unknown[] }
      segments: Array<{
        emotion: string
        speaker: number
        expressionName?: string
        expressionWeight?: number
      }>
    }
    expect(structured.vrmModel?.emotionBindings).toHaveLength(2)
    expect(structured.segments[0]).toMatchObject({
      emotion: 'happy',
      speaker: 8,
      expressionName: 'happy',
      expressionWeight: 0.7,
    })
    expect(structured.segments[1]).toMatchObject({ emotion: 'sad', speaker: 9, expressionName: 'sad' })
    expect(structured.segments[2]).toMatchObject({ emotion: 'neutral', speaker: 1 })
    expect(structured.segments[2].expressionName).toBeUndefined()
  })

  it('pose 未指定セグメントは pose プロパティを保存しない（UI 側で idle 扱い）', async () => {
    const model = await registry.register({ name: 'A', speakerId: 1, vrmBase64: SAMPLE_VRM_BASE64 })
    const harness = buildHarness(registry)

    const result = await harness.invoke({
      modelId: model.id,
      segments: [{ text: 'no pose' }, { pose: 'wave', text: 'with pose' }],
    })

    expect(result.isError).toBeUndefined()
    const structured = result.structuredContent as { segments: Array<{ pose?: string }> }
    expect(structured.segments[0].pose).toBeUndefined()
    expect(structured.segments[1].pose).toBe('wave')
  })
})
