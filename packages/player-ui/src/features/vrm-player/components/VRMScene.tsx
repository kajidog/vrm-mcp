import { type VRM, VRMHumanBoneName, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { type VRMAnimation, VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { type AnimationAction, AnimationMixer, LoopOnce, LoopRepeat, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DEFAULT_POSE_ID, POSE_PRESETS } from '~/features/poses/presets'
import type { PoseSource } from '~/features/poses/types'
import type { MouthRef } from '../hooks/useLipSync'
import type { VrmSource } from '../types'

const DEFAULT_POSE_SOURCE: PoseSource = {
  kind: 'builtin',
  id: `builtin:${DEFAULT_POSE_ID}`,
  presetId: DEFAULT_POSE_ID,
  applyToVrm: POSE_PRESETS[DEFAULT_POSE_ID].applyToVrm,
}

interface VRMSceneProps {
  source: VrmSource
  onError: (message: string) => void
  pose?: PoseSource | null
  // 再生中音声に対するリップシンク値。useLipSync が in-place で更新する。
  mouthRef?: MouthRef
  // VRM ロード完了後、Canvas へ「キャラ上半身付近の y」を通知する。
  onCenterReady?: (y: number) => void
  // VRM ロード完了後、Canvas へ「頭ボーンのワールド座標」を通知する。
  onHeadReady?: (position: [number, number, number]) => void
  onLoadStart?: () => void
  onLoaded?: () => void
}

/**
 * 渡された VrmSource を three.js シーンに常駐表示するコンポーネント。
 * `source.data`（バイナリ）か `source.src`（URL）のいずれかからロードする。
 */
export function VRMScene({
  source,
  onError,
  pose,
  mouthRef,
  onCenterReady,
  onHeadReady,
  onLoadStart,
  onLoaded,
}: VRMSceneProps) {
  const [vrm, setVrm] = useState<VRM | null>(null)
  // lookAt の追従先として現在のカメラを使う（vrm.update() が毎フレーム参照する）。
  const { camera } = useThree()
  // 経過時間（idle の呼吸など、時刻ベースの揺らぎに使う）。useFrame の delta を加算する。
  const elapsedRef = useRef(0)
  // pose は ref に写してから useFrame で参照する（レンダ越しに最新値を拾うため）。
  const poseRef = useRef<PoseSource>(pose ?? DEFAULT_POSE_SOURCE)
  const vrmaCacheRef = useRef<Map<string, Promise<VRMAnimation>>>(new Map())
  const mixerRef = useRef<AnimationMixer | null>(null)
  const actionRef = useRef<AnimationAction | null>(null)
  const activeVrmaKeyRef = useRef<string | null>(null)
  const [loadedVrmaKey, setLoadedVrmaKey] = useState<string | null>(null)

  useEffect(() => {
    poseRef.current = pose ?? DEFAULT_POSE_SOURCE
  }, [pose])

  // onError / onCenterReady を ref 経由で参照し、コールバック差し替えで useEffect が再実行されないようにする。
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const onCenterReadyRef = useRef(onCenterReady)
  useEffect(() => {
    onCenterReadyRef.current = onCenterReady
  }, [onCenterReady])

  const onHeadReadyRef = useRef(onHeadReady)
  useEffect(() => {
    onHeadReadyRef.current = onHeadReady
  }, [onHeadReady])

  const onLoadStartRef = useRef(onLoadStart)
  useEffect(() => {
    onLoadStartRef.current = onLoadStart
  }, [onLoadStart])

  const onLoadedRef = useRef(onLoaded)
  useEffect(() => {
    onLoadedRef.current = onLoaded
  }, [onLoaded])

  useEffect(() => {
    let disposed = false
    let current: VRM | null = null
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    // 切り替え中に古いモデルを残さないように一旦クリア。
    setVrm(null)
    onLoadStartRef.current?.()

    const handleLoaded = (gltf: { userData: Record<string, unknown> }) => {
      const loaded = gltf.userData.vrm as VRM | undefined
      // ロード完了より先にアンマウント／差し替えされたら、出来上がりを即破棄。
      if (disposed) {
        if (loaded) {
          VRMUtils.deepDispose(loaded.scene)
        }
        return
      }

      if (!loaded) {
        onErrorRef.current('VRM として読み込めませんでした。ファイル形式を確認してください。')
        return
      }

      // VRM0 系を立たせ、不要頂点除去・スケルトン結合などの一括最適化。
      VRMUtils.rotateVRM0(loaded)
      VRMUtils.removeUnnecessaryVertices(loaded.scene)
      VRMUtils.combineSkeletons(loaded.scene)
      loaded.scene.updateMatrixWorld(true)
      // Spring Bone を初期姿勢で安定させてから表示する（初動の暴れ防止）。
      loaded.springBoneManager?.setInitState()
      loaded.springBoneManager?.reset()
      loaded.update(0)
      current = loaded
      mixerRef.current = new AnimationMixer(loaded.scene)
      actionRef.current = null
      activeVrmaKeyRef.current = null
      setVrm(loaded)
      onLoadedRef.current?.()

      // カメラ初期位置を上半身寄りにするための y を Canvas 側へ通知する。
      // Chest が無いモデルもあるので Spine→Head の順でフォールバック。
      // VRM の root を (0,-1,0) に置いているため world y も同じ平行移動を加味して報告する。
      const upperBoneNode =
        loaded.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest) ??
        loaded.humanoid.getNormalizedBoneNode(VRMHumanBoneName.UpperChest) ??
        loaded.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine) ??
        loaded.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head) ??
        null
      if (upperBoneNode) {
        const world = new Vector3()
        upperBoneNode.getWorldPosition(world)
        // primitive の position=[0,-1,0] による平行移動を反映。
        onCenterReadyRef.current?.(world.y - 1)
      }

      const headNode = loaded.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head)
      if (headNode) {
        const world = new Vector3()
        headNode.getWorldPosition(world)
        // primitive の position=[0,-1,0] による平行移動を反映。
        onHeadReadyRef.current?.([world.x, world.y - 1, world.z])
      }
    }

    const handleError = (error: unknown) => {
      if (disposed) return
      onErrorRef.current(error instanceof Error ? error.message : String(error))
    }

    const parseArrayBuffer = (data: ArrayBuffer) => {
      // MCP Apps の sandbox では ImageBitmapLoader が内部で blob: fetch を使い、
      // 埋め込みテクスチャ読み込みに失敗することがある。GLTFLoader はこのプロパティの
      // 有無を `parse` 内で同期的に判定するため、parse 呼び出し中だけ undefined に
      // 差し替えて TextureLoader 経路へ寄せる（callback で利用される頃には復元済みでよい）。
      const originalCreateImageBitmap = globalThis.createImageBitmap
      try {
        globalThis.createImageBitmap = undefined as unknown as typeof globalThis.createImageBitmap
        loader.parse(data, '', handleLoaded, handleError)
      } finally {
        globalThis.createImageBitmap = originalCreateImageBitmap
      }
    }

    if (source.data) {
      parseArrayBuffer(source.data)
    } else if (source.src) {
      const controller = new AbortController()
      fetch(source.src, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`VRM の取得に失敗しました: ${response.status} ${response.statusText}`)
          }
          return response.arrayBuffer()
        })
        .then((data) => {
          if (!disposed) parseArrayBuffer(data)
        })
        .catch((error: unknown) => {
          if (disposed || (error instanceof DOMException && error.name === 'AbortError')) return
          handleError(error)
        })

      return () => {
        disposed = true
        controller.abort()
        if (current) {
          mixerRef.current?.stopAllAction()
          mixerRef.current = null
          actionRef.current = null
          VRMUtils.deepDispose(current.scene)
        }
      }
    } else {
      onErrorRef.current('VRM データがありません。')
    }

    return () => {
      disposed = true
      if (current) {
        mixerRef.current?.stopAllAction()
        mixerRef.current = null
        actionRef.current = null
        VRMUtils.deepDispose(current.scene)
      }
    }
  }, [source.data, source.src])

  useEffect(() => {
    if (!vrm) return
    const poseSource = pose ?? DEFAULT_POSE_SOURCE
    poseRef.current = poseSource

    if (poseSource.kind !== 'vrma') {
      mixerRef.current?.stopAllAction()
      actionRef.current = null
      activeVrmaKeyRef.current = null
      vrm.humanoid.resetNormalizedPose()
      setLoadedVrmaKey(null)
      return
    }

    const key = `${poseSource.vrmaUrl}:${poseSource.vrmaData?.byteLength ?? 0}:${poseSource.loop ? 'loop' : 'once'}`
    if (activeVrmaKeyRef.current === key && actionRef.current) return
    mixerRef.current?.stopAllAction()
    actionRef.current = null
    activeVrmaKeyRef.current = key
    vrm.humanoid.resetNormalizedPose()

    let cancelled = false
    const load = getVrmaAnimation(vrmaCacheRef.current, poseSource.vrmaUrl, poseSource.vrmaData)
    load
      .then((vrmAnimation) => {
        if (cancelled || activeVrmaKeyRef.current !== key) return
        const mixer = mixerRef.current ?? new AnimationMixer(vrm.scene)
        mixerRef.current = mixer
        const clip = createVRMAnimationClip(vrmAnimation, vrm)
        const action = mixer.clipAction(clip)
        action.setLoop(poseSource.loop ? LoopRepeat : LoopOnce, poseSource.loop ? Number.POSITIVE_INFINITY : 1)
        action.clampWhenFinished = true
        action.reset().play()
        actionRef.current = action
        setLoadedVrmaKey(key)
      })
      .catch((error: unknown) => {
        if (!cancelled) onErrorRef.current(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
    }
  }, [vrm, pose])

  // 目線追従: vrm.lookAt.target にカメラを刺すと vrm.update() が眼/頭骨を毎フレーム回す。
  // モデル差し替え時は新しい vrm に対して再度設定する必要がある。
  useEffect(() => {
    if (!vrm?.lookAt) return
    vrm.lookAt.target = camera
    return () => {
      if (vrm.lookAt) vrm.lookAt.target = null
    }
  }, [vrm, camera])

  // 毎フレーム delta を渡して spring bone / 表情 / lookAt をシミュレーションする。
  // ポーズはヒューマノイドの正規化ボーン回転を上書きするので、vrm.update() の前に
  // 適用してから update でラインを正規化→生ボーンに反映させる（これで spring と競合しない）。
  // 口形は vrm.update() がモーフを mesh に転写する前に書き込む必要がある。
  useFrame((_, delta) => {
    if (!vrm) return
    elapsedRef.current += delta
    const poseSource = poseRef.current
    if (poseSource.kind === 'builtin') {
      mixerRef.current?.stopAllAction()
      actionRef.current = null
      activeVrmaKeyRef.current = null
      poseSource.applyToVrm(vrm, elapsedRef.current)
    } else if (loadedVrmaKey === activeVrmaKeyRef.current) {
      mixerRef.current?.update(delta)
    }
    const em = vrm.expressionManager
    const mouth = mouthRef?.current
    if (em && mouth) {
      em.setValue('aa', mouth.aa)
      em.setValue('ih', mouth.ih)
      em.setValue('ou', mouth.ou)
      em.setValue('ee', mouth.ee)
      em.setValue('oh', mouth.oh)
    }
    vrm.update(delta)
  })

  if (!vrm) return null

  // VRM のルートが原点(0,0,0)に立つので、足元をグリッドに合わせて少し下げる。
  return <primitive object={vrm.scene} position={[0, -1, 0]} />
}

function getVrmaAnimation(
  cache: Map<string, Promise<VRMAnimation>>,
  vrmaUrl: string,
  vrmaData?: ArrayBuffer
): Promise<VRMAnimation> {
  const cacheKey = `${vrmaUrl}:${vrmaData?.byteLength ?? 0}`
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const promise = new Promise<VRMAnimation>((resolve, reject) => {
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
    const handleLoaded = (gltf: { userData: Record<string, unknown> }) => {
      const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined
      const animation = animations?.[0]
      if (!animation) {
        reject(new Error('VRMA として読み込めませんでした。ファイル形式を確認してください。'))
        return
      }
      resolve(animation)
    }
    if (vrmaData) {
      loader.parse(vrmaData.slice(0), '', handleLoaded, reject)
      return
    }
    loader.load(vrmaUrl, handleLoaded, undefined, reject)
  })
  cache.set(cacheKey, promise)
  return promise
}
