import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VrmRegistryStore } from '../vrm-registry/store.js'

const TMP = join(process.cwd(), '__test_vrm_registry_tmp__')

function createStore() {
  return new VrmRegistryStore({ cacheDir: TMP })
}

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

describe('VrmRegistryStore', () => {
  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  it('VRMを登録するとメタとバイナリが保存される', async () => {
    const store = createStore()
    const model = await store.register({
      name: 'Alice',
      speakerId: 1,
      vrmBase64: SAMPLE_VRM_BASE64,
    })

    expect(model.id).toBeTypeOf('string')
    expect(model.name).toBe('Alice')
    expect(model.isDefault).toBe(true)
    expect(model.isPublic).toBe(false)
    expect(model.poses?.map((pose) => pose.poseId)).toEqual([
      'builtin:idle',
      'builtin:neutral',
      'builtin:wave',
      'builtin:bow',
      'builtin:point',
      'builtin:think',
      'builtin:cheer',
    ])
    expect(model.vrmSizeBytes).toBe(SAMPLE_VRM_BYTES.byteLength)
    expect(existsSync(model.vrmFilePath)).toBe(true)
    expect(readFileSync(model.vrmFilePath)).toEqual(SAMPLE_VRM_BYTES)
  })

  it('感情ごとの表情/話者設定を保存・更新できる', async () => {
    const store = new VrmRegistryStore({ cacheDir: TMP })
    const model = await store.register({
      name: 'A',
      speakerId: 1,
      emotionBindings: [{ emotion: 'happy', expressionName: 'happy', speakerId: 7, weight: 0.8 }],
      vrmBase64: SAMPLE_VRM_BASE64,
    })

    expect(model.emotionBindings).toEqual([{ emotion: 'happy', expressionName: 'happy', speakerId: 7, weight: 0.8 }])

    const updated = store.update(model.id, {
      emotionBindings: [{ emotion: 'sad', expressionName: 'sad', speakerId: 9 }],
    })

    expect(updated.emotionBindings).toEqual([{ emotion: 'sad', expressionName: 'sad', speakerId: 9 }])
  })

  it('isDefault=true で登録するとそれが default になる', async () => {
    const store = createStore()
    const model = await store.register({
      name: 'Alice',
      speakerId: 1,
      isDefault: true,
      vrmBase64: SAMPLE_VRM_BASE64,
    })
    expect(store.getDefault()?.id).toBe(model.id)
  })

  it('所有者ごとの1件目は isDefault 指定なしでも default になる', async () => {
    const store = createStore()
    const a = await store.register({
      ownerUserId: 'user-a',
      name: 'A',
      speakerId: 1,
      vrmBase64: SAMPLE_VRM_BASE64,
    })
    const b = await store.register({
      ownerUserId: 'user-b',
      name: 'B',
      speakerId: 2,
      vrmBase64: SAMPLE_VRM_BASE64,
    })

    expect(a.isDefault).toBe(true)
    expect(b.isDefault).toBe(true)
    expect(store.getDefault('user-a')?.id).toBe(a.id)
    expect(store.getDefault('user-b')?.id).toBe(b.id)
  })

  it('複数の isDefault を作っても 1 件しか default は残らない', async () => {
    const store = createStore()
    const a = await store.register({ name: 'A', speakerId: 1, isDefault: true, vrmBase64: SAMPLE_VRM_BASE64 })
    const b = await store.register({ name: 'B', speakerId: 2, isDefault: true, vrmBase64: SAMPLE_VRM_BASE64 })

    expect(store.get(a.id)?.isDefault).toBe(false)
    expect(store.get(b.id)?.isDefault).toBe(true)
    expect(store.getDefault()?.id).toBe(b.id)
  })

  it('default はユーザーごとに独立する', async () => {
    const store = createStore()
    const a = await store.register({
      ownerUserId: 'user-a',
      name: 'A',
      speakerId: 1,
      isDefault: true,
      vrmBase64: SAMPLE_VRM_BASE64,
    })
    const b = await store.register({
      ownerUserId: 'user-b',
      name: 'B',
      speakerId: 2,
      isDefault: true,
      vrmBase64: SAMPLE_VRM_BASE64,
    })

    expect(store.getDefault('user-a')?.id).toBe(a.id)
    expect(store.getDefault('user-b')?.id).toBe(b.id)
    expect(store.get(a.id)?.isDefault).toBe(true)
    expect(store.get(b.id)?.isDefault).toBe(true)
  })

  it('公開VRMは他ユーザーから可視、非公開VRMは不可視', async () => {
    const store = createStore()
    const privateModel = await store.register({
      ownerUserId: 'user-a',
      name: 'Private',
      speakerId: 1,
      vrmBase64: SAMPLE_VRM_BASE64,
    })
    const publicModel = await store.register({
      ownerUserId: 'user-a',
      name: 'Public',
      speakerId: 1,
      isPublic: true,
      vrmBase64: SAMPLE_VRM_BASE64,
    })

    expect(store.listVisible({ userId: 'user-b', usePublicVrms: true }).map((model) => model.id)).toEqual([
      publicModel.id,
    ])
    expect(store.getVisible(publicModel.id, { userId: 'user-b', usePublicVrms: true })?.id).toBe(publicModel.id)
    expect(store.getVisible(privateModel.id, { userId: 'user-b', usePublicVrms: true })).toBeUndefined()
    expect(store.listVisible({ userId: 'user-b', usePublicVrms: false })).toEqual([])
  })

  it('公開VRMでも所有者以外は更新・削除できない', async () => {
    const store = createStore()
    const model = await store.register({
      ownerUserId: 'user-a',
      name: 'Public',
      speakerId: 1,
      isPublic: true,
      vrmBase64: SAMPLE_VRM_BASE64,
    })

    expect(() => store.update(model.id, { name: 'hacked' }, 'user-b')).toThrow(/VRM not found/)
    await expect(store.replaceBinary(model.id, SAMPLE_VRM_BASE64, 'user-b')).rejects.toThrow(/VRM not found/)
    await expect(store.delete(model.id, 'user-b')).rejects.toThrow(/VRM not found/)
    expect(store.get(model.id)?.name).toBe('Public')
  })

  it('updateで isDefault=true にすると他の default が解除される', async () => {
    const store = createStore()
    const a = await store.register({ name: 'A', speakerId: 1, isDefault: true, vrmBase64: SAMPLE_VRM_BASE64 })
    const b = await store.register({ name: 'B', speakerId: 2, vrmBase64: SAMPLE_VRM_BASE64 })

    store.update(b.id, { isDefault: true })

    expect(store.get(a.id)?.isDefault).toBe(false)
    expect(store.get(b.id)?.isDefault).toBe(true)
  })

  it('updateで部分的にメタを更新できる', async () => {
    const store = createStore()
    const m = await store.register({ name: 'A', speakerId: 1, vrmBase64: SAMPLE_VRM_BASE64 })

    const updated = store.update(m.id, { name: 'Renamed', speakerId: 7 })

    expect(updated.name).toBe('Renamed')
    expect(updated.speakerId).toBe(7)
    expect(updated.isDefault).toBe(true)
    expect(updated.updatedAt).toBeGreaterThanOrEqual(m.updatedAt)
  })

  it('最後の default を false に更新しても default は残る', async () => {
    const store = createStore()
    const m = await store.register({ name: 'A', speakerId: 1, vrmBase64: SAMPLE_VRM_BASE64 })

    const updated = store.update(m.id, { isDefault: false })

    expect(updated.isDefault).toBe(true)
    expect(store.getDefault()?.id).toBe(m.id)
  })

  it('default を削除すると同じ所有者の残りから default が補充される', async () => {
    const store = createStore()
    const a = await store.register({ name: 'A', speakerId: 1, isDefault: true, vrmBase64: SAMPLE_VRM_BASE64 })
    const b = await store.register({ name: 'B', speakerId: 2, vrmBase64: SAMPLE_VRM_BASE64 })

    await store.delete(a.id)

    expect(store.get(b.id)?.isDefault).toBe(true)
    expect(store.getDefault()?.id).toBe(b.id)
  })

  it('削除するとメタもファイルも消える', async () => {
    const store = createStore()
    const m = await store.register({ name: 'A', speakerId: 1, vrmBase64: SAMPLE_VRM_BASE64 })
    const filePath = m.vrmFilePath

    await store.delete(m.id)

    expect(store.get(m.id)).toBeUndefined()
    expect(existsSync(filePath)).toBe(false)
  })

  it('readVrmBase64で登録したバイナリを取り出せる', async () => {
    const store = createStore()
    const m = await store.register({ name: 'A', speakerId: 1, vrmBase64: SAMPLE_VRM_BASE64 })

    expect(store.readVrmBase64(m.id)).toBe(SAMPLE_VRM_BASE64)
  })

  it('未登録IDの取得・削除はエラーにならない / 取得はthrow', async () => {
    const store = createStore()
    await expect(store.delete('non-existent')).resolves.toBeUndefined()
    expect(() => store.readVrmBase64('non-existent')).toThrow(/VRM not found/)
    expect(() => store.update('non-existent', { name: 'x' })).toThrow(/VRM not found/)
  })

  it('不正なbase64は登録しない', async () => {
    const store = createStore()
    await expect(
      store.register({
        name: 'Broken',
        speakerId: 1,
        vrmBase64: 'not base64!!!',
      })
    ).rejects.toThrow(/base64/)
  })

  it('GLB/VRMではないbase64は登録しない', async () => {
    const store = createStore()
    await expect(
      store.register({
        name: 'Not VRM',
        speakerId: 1,
        vrmBase64: Buffer.from('plain text').toString('base64'),
      })
    ).rejects.toThrow(/glTF/)
  })

  it('永続化したJSONを別インスタンスで読み戻せる', async () => {
    const store = createStore()
    const m = await store.register({ name: 'Persisted', speakerId: 3, vrmBase64: SAMPLE_VRM_BASE64 })
    await store.flush()

    const reloaded = createStore()
    const got = reloaded.get(m.id)
    expect(got).toBeDefined()
    expect(got?.name).toBe('Persisted')
    expect(got?.speakerId).toBe(3)
    expect(reloaded.readVrmBase64(m.id)).toBe(SAMPLE_VRM_BASE64)
  })

  it('listは更新時刻降順で返す', async () => {
    const store = createStore()
    const a = await store.register({ name: 'A', speakerId: 1, vrmBase64: SAMPLE_VRM_BASE64 })
    await new Promise((r) => setTimeout(r, 5))
    const b = await store.register({ name: 'B', speakerId: 2, vrmBase64: SAMPLE_VRM_BASE64 })

    const list = store.list()
    expect(list[0]?.id).toBe(b.id)
    expect(list[1]?.id).toBe(a.id)
  })
})
