import { type VRM, VRMHumanBoneName, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { type VRMAnimation, VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import {
  type AnimationAction,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type Object3D,
  type Quaternion,
  Vector3,
} from 'three'
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
  expression?: { name: string; weight: number } | null
  // 再生中音声に対するリップシンク値。useLipSync が in-place で更新する。
  mouthRef?: MouthRef
  // 自動瞬き。OFF のときは blink 系表情へは何も書き込まない。
  blinkEnabled?: boolean
  // VRM ロード完了後、Canvas へ「キャラ上半身付近の y」を通知する。
  onCenterReady?: (y: number) => void
  // VRM ロード完了後、Canvas へ「頭ボーンのワールド座標」を通知する。
  onHeadReady?: (position: [number, number, number]) => void
  onExpressionsReady?: (names: string[]) => void
  onLoadStart?: () => void
  onLoaded?: () => void
}

// 一回の瞬きにかける時間（秒）。閉じ→開きで均等に消費する。
const BLINK_DURATION = 0.16
// 次の瞬きまでのインターバル下限／上限（秒）。
const BLINK_INTERVAL_MIN = 2.5
const BLINK_INTERVAL_MAX = 5.5

interface BlinkState {
  // 次の瞬き開始までの待ち時間。
  nextAt: number
  // 瞬き中の経過時間。null なら待機中。
  progress: number | null
}

function nextBlinkInterval(): number {
  return BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN)
}

// ポーズ切替時のクロスブレンド秒数。短すぎるとカクつき、長すぎると次の動きに遅延が乗る。
const POSE_TRANSITION_DURATION = 0.35

interface PoseTransition {
  // 経過秒。duration 到達で完了。
  elapsed: number
  duration: number
  // 切替前のヒューマノイドボーン姿勢スナップショット（ノード参照→quaternion）。
  from: Map<Object3D, Quaternion>
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

/**
 * 渡された VrmSource を three.js シーンに常駐表示するコンポーネント。
 * `source.data`（バイナリ）か `source.src`（URL）のいずれかからロードする。
 */
export function VRMScene({
  source,
  onError,
  pose,
  expression,
  mouthRef,
  blinkEnabled = true,
  onCenterReady,
  onHeadReady,
  onExpressionsReady,
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
  const expressionRef = useRef<{ name: string; weight: number } | null>(expression ?? null)
  const blinkEnabledRef = useRef(blinkEnabled)
  const blinkStateRef = useRef<BlinkState>({ nextAt: nextBlinkInterval(), progress: null })
  const vrmaCacheRef = useRef<Map<string, Promise<VRMAnimation>>>(new Map())
  const mixerRef = useRef<AnimationMixer | null>(null)
  const actionRef = useRef<AnimationAction | null>(null)
  const activeVrmaKeyRef = useRef<string | null>(null)
  const [loadedVrmaKey, setLoadedVrmaKey] = useState<string | null>(null)
  // 直近に切替えたポーズの id。同 id 再適用時には遷移を起動しない。
  const lastPoseIdRef = useRef<string | null>(null)
  const poseTransitionRef = useRef<PoseTransition | null>(null)
  // ポーズ effect が「同じ pose 識別子」と判定するときも、VRM 自体が差し変わっていれば
  // 旧モデルのボーンノードを参照したスナップショットを残さないために再起動する。
  const lastVrmRef = useRef<VRM | null>(null)

  useEffect(() => {
    poseRef.current = pose ?? DEFAULT_POSE_SOURCE
  }, [pose])

  useEffect(() => {
    expressionRef.current = expression ?? null
  }, [expression])

  useEffect(() => {
    blinkEnabledRef.current = blinkEnabled
    if (!blinkEnabled) {
      // 即座に開いた状態へ戻す。次の有効化時は新しい間隔から再開する。
      blinkStateRef.current = { nextAt: nextBlinkInterval(), progress: null }
    }
  }, [blinkEnabled])

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

  const onExpressionsReadyRef = useRef(onExpressionsReady)
  useEffect(() => {
    onExpressionsReadyRef.current = onExpressionsReady
  }, [onExpressionsReady])

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
      onExpressionsReadyRef.current?.(Object.keys(loaded.expressionManager?.expressionMap ?? {}).sort())
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

    // モデルが差し替わった場合は旧スナップショットを破棄して比較 id もリセット。
    if (lastVrmRef.current !== vrm) {
      poseTransitionRef.current = null
      lastPoseIdRef.current = null
      lastVrmRef.current = vrm
    }

    // ポーズ id が変化した時だけ、現在のヒューマノイドボーン姿勢をスナップショットして
    // 遷移を起動する。これにより useFrame 側で旧姿勢→新姿勢を slerp で滑らかに繋げる。
    if (lastPoseIdRef.current !== poseSource.id) {
      const snapshot = new Map<Object3D, Quaternion>()
      for (const name of Object.values(VRMHumanBoneName)) {
        const node = vrm.humanoid.getNormalizedBoneNode(name)
        if (node) snapshot.set(node, node.quaternion.clone())
      }
      poseTransitionRef.current = { elapsed: 0, duration: POSE_TRANSITION_DURATION, from: snapshot }
      lastPoseIdRef.current = poseSource.id
    }

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

    // 切替直後の数フレームは、適用済みボーン（=新ポーズ）を旧ポーズへ slerp で寄せ、
    // duration をかけて 0 に近づけることで滑らかに遷移する。
    // slerp(to, from, 1-t) = slerp(from, to, t) なのでイージング後の 1-t を渡す。
    const transition = poseTransitionRef.current
    if (transition) {
      transition.elapsed += delta
      const rawT = Math.min(1, transition.elapsed / transition.duration)
      const eased = easeInOutQuad(rawT)
      const blendBack = 1 - eased
      if (rawT >= 1) {
        poseTransitionRef.current = null
      } else {
        for (const [node, fromQuat] of transition.from) {
          node.quaternion.slerp(fromQuat, blendBack)
        }
      }
    }
    const em = vrm.expressionManager
    const expression = expressionRef.current
    if (em) {
      for (const name of Object.keys(em.expressionMap)) {
        if (!em.mouthExpressionNames.includes(name)) em.setValue(name, 0)
      }
      if (expression && em.getExpression(expression.name)) {
        em.setValue(expression.name, expression.weight)
      }
    }
    const mouth = mouthRef?.current
    if (em && mouth) {
      em.setValue('aa', mouth.aa)
      em.setValue('ih', mouth.ih)
      em.setValue('ou', mouth.ou)
      em.setValue('ee', mouth.ee)
      em.setValue('oh', mouth.oh)
    }
    if (em && blinkEnabledRef.current) {
      const blinkState = blinkStateRef.current
      if (blinkState.progress === null) {
        blinkState.nextAt -= delta
        if (blinkState.nextAt <= 0) blinkState.progress = 0
      }
      if (blinkState.progress !== null) {
        blinkState.progress += delta
        const t = Math.min(1, blinkState.progress / BLINK_DURATION)
        // 0→1→0 の三角波。中間で完全に閉じる。
        const weight = t < 0.5 ? t * 2 : (1 - t) * 2
        applyBlinkWeight(em, weight)
        if (blinkState.progress >= BLINK_DURATION) {
          applyBlinkWeight(em, 0)
          blinkState.progress = null
          blinkState.nextAt = nextBlinkInterval()
        }
      }
    }
    vrm.update(delta)
  })

  if (!vrm) return null

  // VRM のルートが原点(0,0,0)に立つので、足元をグリッドに合わせて少し下げる。
  return <primitive object={vrm.scene} position={[0, -1, 0]} />
}

// VRM1 は preset 名 "blink"（両目）を持つ。VRM0 由来や独自命名のモデルでは
// 片目だけが定義されていることもあるので、両目→片目のフォールバックを両方試す。
type BlinkEm = NonNullable<VRM['expressionManager']>
function applyBlinkWeight(em: BlinkEm, weight: number) {
  if (em.getExpression('blink')) {
    em.setValue('blink', weight)
    return
  }
  if (em.getExpression('blinkLeft')) em.setValue('blinkLeft', weight)
  if (em.getExpression('blinkRight')) em.setValue('blinkRight', weight)
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
