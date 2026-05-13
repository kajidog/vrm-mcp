import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServerConfig } from '../config.js'
import { PoseRegistryStore } from '../tools/pose-registry/store.js'
import { registerVrmPublicTools } from '../tools/vrm-registry/public-tools.js'
import { VrmRegistryStore } from '../tools/vrm-registry/store.js'

const TMP = join(process.cwd(), '__test_list_vrms_tmp__')

const SAMPLE_VRM_BYTES = Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0x0c, 0x00, 0x00, 0x00])
const SAMPLE_VRM_BASE64 = SAMPLE_VRM_BYTES.toString('base64')

function buildHarness(registry: VrmRegistryStore) {
  const registrations: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<CallToolResult> }> = []
  const server = {
    registerTool: (
      name: string,
      _config: unknown,
      handler: (args: Record<string, unknown>) => Promise<CallToolResult>
    ) => {
      registrations.push({ name, handler })
    },
    registerAppTool: (
      name: string,
      _config: unknown,
      handler: (args: Record<string, unknown>) => Promise<CallToolResult>
    ) => {
      registrations.push({ name, handler })
    },
  } as unknown as Parameters<typeof registerVrmPublicTools>[0]['server']

  const config = {
    httpHost: 'localhost',
    httpPort: 8765,
    autoPlay: true,
    defaultSpeedScale: 1,
  } as unknown as ServerConfig

  registerVrmPublicTools(
    {
      server,
      ttsClient: {
        checkHealth: async () => ({ connected: true, version: 'test', url: 'http://localhost:50021' }),
      } as never,
      engine: { id: 'voicevox', displayName: 'VOICEVOX' } as never,
      capabilities: {} as never,
      config,
      disabledTools: new Set(),
    },
    registry,
    new PoseRegistryStore({ cacheDir: TMP })
  )

  return (toolName = 'list_vrms', args: Record<string, unknown> = {}) => {
    const registration = registrations.find((r) => r.name.endsWith(toolName))
    if (!registration) throw new Error(`${toolName} was not registered`)
    return registration.handler(args)
  }
}

describe('list_vrms public tool', () => {
  let registry: VrmRegistryStore

  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    registry = new VrmRegistryStore({ cacheDir: TMP })
  })

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  it('登録 VRM が無いときは空配列を返す', async () => {
    const invoke = buildHarness(registry)
    const result = await invoke()
    expect(result.isError).toBeUndefined()
    const structured = result.structuredContent as { vrms: unknown[] }
    expect(structured.vrms).toEqual([])
  })

  it('登録済み VRM のメタデータを返す（vrmUrl 付き、バイナリは含めない）', async () => {
    const a = await registry.register({
      name: 'Alice',
      speakerId: 7,
      isDefault: true,
      vrmBase64: SAMPLE_VRM_BASE64,
    })
    const b = await registry.register({ name: 'Bob', speakerId: 3, vrmBase64: SAMPLE_VRM_BASE64 })

    const invoke = buildHarness(registry)
    const result = await invoke()

    expect(result.isError).toBeUndefined()
    const structured = result.structuredContent as {
      vrms: Array<{
        id: string
        name: string
        speakerId: number
        isDefault: boolean
        vrmUrl: string
        vrmSizeBytes: number
      }>
    }

    expect(structured.vrms).toHaveLength(2)
    const alice = structured.vrms.find((v) => v.id === a.id)
    expect(alice).toMatchObject({
      name: 'Alice',
      speakerId: 7,
      isDefault: true,
      vrmUrl: `http://localhost:8765/vrms/${a.id}.vrm`,
      vrmSizeBytes: SAMPLE_VRM_BYTES.byteLength,
    })
    const bob = structured.vrms.find((v) => v.id === b.id)
    expect(bob?.isDefault).toBe(false)

    expect(JSON.stringify(result)).not.toContain('vrmBase64')
    expect(JSON.stringify(result)).not.toContain('vrmFilePath')
  })

  it('start_here は最初に必要な状態と既定ポーズを返す', async () => {
    const invoke = buildHarness(registry)
    const result = await invoke('start_here')

    expect(result.isError).toBeUndefined()
    const structured = result.structuredContent as {
      engine: { connected: boolean }
      modelsCount: number
      defaultPoses: string[]
      emotions: string[]
      registrationGuide?: string
    }
    expect(structured.engine.connected).toBe(true)
    expect(structured.modelsCount).toBe(0)
    expect(structured.defaultPoses).toContain('idle')
    expect(structured.emotions).toContain('happy')
    expect(structured.registrationGuide).toMatch(/No VRM model is registered/)
    expect(JSON.stringify(structured)).not.toContain('requiresMcpApps')
  })

  it('find_models はモデル名検索とポーズ名返却ができる', async () => {
    const model = await registry.register({ name: 'Alice', speakerId: 7, vrmBase64: SAMPLE_VRM_BASE64 })
    const invoke = buildHarness(registry)
    const result = await invoke('find_models', { query: 'ali' })

    expect(result.isError).toBeUndefined()
    const structured = result.structuredContent as { models: Array<{ modelId: string; poses: string[] }> }
    expect(structured.models).toHaveLength(1)
    expect(structured.models[0].modelId).toBe(model.id)
    expect(structured.models[0].poses).toContain('wave')
  })
})
