import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { type ComponentRef, useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import type { PosePresetId } from '../../poses/presets'
import { useColorScheme } from '../hooks/useColorScheme'
import type { VrmSource } from '../types'
import { VRMScene } from './VRMScene'

// drei の OrbitControls はサードパーティ実装（three-stdlib）を ref に出すので、
// その型は drei コンポーネントから ComponentRef で取り出して同じ型を共有する。
type OrbitControlsImpl = ComponentRef<typeof OrbitControls>

interface VRMCanvasProps {
  // null のときはモデル無しの空シーンを描画する（背景・ライト・グリッドのみ）。
  source: VrmSource | null
  onError: (message: string) => void
  pose?: PosePresetId
  // 吹き出しに出すテキスト。null のときは吹き出しを描画しない。
  speechText: string | null
  fullscreen?: boolean
}

const SCENE_COLORS = {
  light: { canvasBg: '#f3f4f6', gridA: '#d4d4d8', gridB: '#e4e4e7' },
  dark: { canvasBg: '#1c1c1e', gridA: '#2c2c2e', gridB: '#38383a' },
} as const

/**
 * 左右ボタン同時押し中だけパン（target 平行移動）するハンドラを仕込む。
 * OrbitControls の標準では左=回転 / 右=パンになっているので、
 * 同時押し検出中のみ enableRotate=false にして「左+右で動くドラッグ」を成立させる。
 */
function DualButtonPanController({ controlsRef }: { controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const { gl, camera } = useThree()

  useEffect(() => {
    const dom = gl.domElement
    const buttons = new Set<number>()
    let lastX = 0
    let lastY = 0
    let panActive = false
    // パン中だけ rotate を切る。終わったら必ず元に戻すため、有効化前の値を覚えておく。
    let originalEnableRotate = true

    const startPanIfNeeded = (event: PointerEvent) => {
      if (panActive) return
      if (!buttons.has(0) || !buttons.has(2)) return
      const controls = controlsRef.current
      if (!controls) return
      panActive = true
      originalEnableRotate = controls.enableRotate
      controls.enableRotate = false
      lastX = event.clientX
      lastY = event.clientY
    }

    const stopPan = () => {
      if (!panActive) return
      panActive = false
      const controls = controlsRef.current
      if (controls) controls.enableRotate = originalEnableRotate
    }

    const onPointerDown = (event: PointerEvent) => {
      buttons.add(event.button)
      // contextmenu を抑止しないと右クリックでメニューが出てパンが切れる。
      if (event.button === 2) event.preventDefault()
      startPanIfNeeded(event)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!panActive) return
      const controls = controlsRef.current
      if (!controls) return
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY

      // カメラ平面に沿って target を動かす。fov と target 距離からピクセル→世界座標換算する。
      const offset = new Vector3().subVectors(camera.position, controls.target)
      const distance = offset.length()
      const halfHeight = Math.tan(((camera as { fov?: number }).fov ?? 50) * 0.5 * (Math.PI / 180)) * distance
      const rect = dom.getBoundingClientRect()
      const worldPerPixel = (halfHeight * 2) / rect.height

      const right = new Vector3().setFromMatrixColumn(camera.matrix, 0)
      const up = new Vector3().setFromMatrixColumn(camera.matrix, 1)
      const move = new Vector3()
      move.addScaledVector(right, -dx * worldPerPixel)
      move.addScaledVector(up, dy * worldPerPixel)
      controls.target.add(move)
      camera.position.add(move)
      controls.update()
    }

    const onPointerUp = (event: PointerEvent) => {
      buttons.delete(event.button)
      if (panActive && (!buttons.has(0) || !buttons.has(2))) {
        stopPan()
      }
    }

    const onPointerLeave = () => {
      buttons.clear()
      stopPan()
    }

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
    }

    dom.addEventListener('pointerdown', onPointerDown)
    dom.addEventListener('pointermove', onPointerMove)
    dom.addEventListener('pointerup', onPointerUp)
    dom.addEventListener('pointerleave', onPointerLeave)
    dom.addEventListener('contextmenu', onContextMenu)

    return () => {
      dom.removeEventListener('pointerdown', onPointerDown)
      dom.removeEventListener('pointermove', onPointerMove)
      dom.removeEventListener('pointerup', onPointerUp)
      dom.removeEventListener('pointerleave', onPointerLeave)
      dom.removeEventListener('contextmenu', onContextMenu)
      stopPan()
    }
  }, [gl, camera, controlsRef])

  return null
}

/**
 * VRM ロード後の上半身付近の y を controls.target / camera に反映する。
 * 同じ y を二重適用しないよう lastApplied をキャッシュする。
 */
function CenterController({
  controlsRef,
  centerY,
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  centerY: number | null
}) {
  const { camera } = useThree()
  const lastAppliedRef = useRef<number | null>(null)

  useEffect(() => {
    if (centerY === null) return
    if (lastAppliedRef.current === centerY) return
    const controls = controlsRef.current
    if (!controls) return
    const dy = centerY - controls.target.y
    controls.target.y = centerY
    camera.position.y += dy
    controls.update()
    lastAppliedRef.current = centerY
  }, [centerY, camera, controlsRef])

  return null
}

/**
 * three.js のキャンバスとシーン構成（背景・ライト・グリッド・カメラ操作）を担当。
 * モデルそのものの読み込みは `VRMScene` 側に委譲する。
 */
export function VRMCanvas({ source, onError, pose, speechText, fullscreen = false }: VRMCanvasProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const colorScheme = useColorScheme()
  const colors = SCENE_COLORS[colorScheme]
  // VRMScene からセンタリング情報（上半身 y）を受け取って、カメラ追従と吹き出し位置に流す。
  const [centerY, setCenterY] = useState<number | null>(null)

  return (
    <div
      className={`vrm-canvas-host overflow-hidden border border-[var(--ui-border)] bg-[var(--ui-surface)] ${
        fullscreen ? 'h-full min-h-0 rounded-none' : 'rounded-lg'
      }`}
    >
      <div className={fullscreen ? 'h-full min-h-0 w-full' : 'h-[420px] w-full'}>
        <Canvas
          camera={{ position: [0, 1.35, 2.2], fov: 28 }}
          // 高 DPI 端末でも上限を 1.5 にして描画コストを抑える。
          dpr={[1, 1.5]}
          gl={{
            antialias: false,
            powerPreference: 'high-performance',
          }}
        >
          <color attach="background" args={[colors.canvasBg]} />
          <ambientLight intensity={1.2} />
          <directionalLight position={[1.5, 2.5, 2]} intensity={1.5} />
          <directionalLight position={[-1, 1.5, -1]} intensity={0.5} />
          <gridHelper args={[6, 12, colors.gridA, colors.gridB]} position={[0, -1, 0]} />
          {source ? <VRMScene source={source} onError={onError} pose={pose} onCenterReady={setCenterY} /> : null}
          {/* 仮置き target。ロード完了後に CenterController が VRM の上半身高さに更新する。 */}
          <OrbitControls ref={controlsRef} enablePan={false} target={[0, 1.1, 0]} />
          <DualButtonPanController controlsRef={controlsRef} />
          <CenterController controlsRef={controlsRef} centerY={centerY} />
          {speechText ? <SpeechBubble3D centerY={centerY} text={speechText} /> : null}
        </Canvas>
      </div>
    </div>
  )
}

/**
 * キャラクターの右側に浮かぶ吹き出し。drei の Html をワールド座標に貼り、DOM で見栄えを作る。
 * centerY が null（VRM 未ロード等）の時は仮値で 0.4 を使う。
 */
function SpeechBubble3D({ centerY, text }: { centerY: number | null; text: string }) {
  const y = (centerY ?? 0.4) + 0.35
  return (
    <Html position={[0.5, y, 0]} center transform sprite distanceFactor={1.4} zIndexRange={[100, 0]}>
      <div className="pointer-events-none w-[min(420px,70vw)] whitespace-pre-wrap break-words rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bubble-bg)] px-3 py-2 text-xs leading-relaxed text-[var(--ui-text)] shadow-lg">
        {text}
      </div>
    </Html>
  )
}
