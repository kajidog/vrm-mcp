import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { type ComponentRef, useEffect, useRef, useState } from 'react'
import type { PosePresetId } from '~/features/poses/presets'
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
  hasSegments?: boolean
  fullscreen?: boolean
  onPrev?: () => void
  onNext?: () => void
}

const SCENE_COLORS = {
  light: { canvasBg: '#f3f4f6', gridA: '#d4d4d8', gridB: '#e4e4e7' },
  dark: { canvasBg: '#1c1c1e', gridA: '#2c2c2e', gridB: '#38383a' },
} as const

/**
 * 右ドラッグでパンする際に出てしまうブラウザの contextmenu を抑止する。
 * OrbitControls 自身は preventDefault しないので、最低限ここで止める。
 */
function CanvasContextMenuSuppressor() {
  const { gl } = useThree()
  useEffect(() => {
    const dom = gl.domElement
    const onContextMenu = (event: MouseEvent) => event.preventDefault()
    dom.addEventListener('contextmenu', onContextMenu)
    return () => dom.removeEventListener('contextmenu', onContextMenu)
  }, [gl])
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

function WheelTrackController({
  controlsRef,
  hasSegments,
  onPrev,
  onNext,
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>
  hasSegments: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const { camera, gl } = useThree()
  const middleDragRef = useRef<{ active: boolean; lastY: number }>({ active: false, lastY: 0 })
  const lastWheelSwitchRef = useRef(0)

  useEffect(() => {
    const dom = gl.domElement

    const zoomByDelta = (deltaY: number) => {
      const controls = controlsRef.current
      if (!controls) return
      const target = controls.target
      const direction = camera.position.clone().sub(target)
      const distance = direction.length()
      if (distance <= 0) return
      const nextDistance = Math.min(8, Math.max(0.45, distance * (1 + deltaY * 0.004)))
      camera.position.copy(target).add(direction.normalize().multiplyScalar(nextDistance))
      controls.update()
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.shiftKey) {
        zoomByDelta(event.deltaY)
        return
      }
      if (!hasSegments || middleDragRef.current.active) return
      const now = Date.now()
      if (now - lastWheelSwitchRef.current < 200) return
      lastWheelSwitchRef.current = now
      if (event.deltaY > 0) onNext()
      else if (event.deltaY < 0) onPrev()
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 1) return
      event.preventDefault()
      middleDragRef.current = { active: true, lastY: event.clientY }
      dom.setPointerCapture?.(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!middleDragRef.current.active) return
      event.preventDefault()
      const dy = event.clientY - middleDragRef.current.lastY
      middleDragRef.current.lastY = event.clientY
      zoomByDelta(dy)
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!middleDragRef.current.active) return
      event.preventDefault()
      middleDragRef.current = { active: false, lastY: 0 }
      dom.releasePointerCapture?.(event.pointerId)
    }

    dom.addEventListener('wheel', onWheel, { passive: false })
    dom.addEventListener('pointerdown', onPointerDown)
    dom.addEventListener('pointermove', onPointerMove)
    dom.addEventListener('pointerup', onPointerUp)
    dom.addEventListener('pointercancel', onPointerUp)
    return () => {
      dom.removeEventListener('wheel', onWheel)
      dom.removeEventListener('pointerdown', onPointerDown)
      dom.removeEventListener('pointermove', onPointerMove)
      dom.removeEventListener('pointerup', onPointerUp)
      dom.removeEventListener('pointercancel', onPointerUp)
    }
  }, [camera, controlsRef, gl, hasSegments, onNext, onPrev])

  return null
}

/**
 * three.js のキャンバスとシーン構成（背景・ライト・グリッド・カメラ操作）を担当。
 * モデルそのものの読み込みは `VRMScene` 側に委譲する。
 */
export function VRMCanvas({
  source,
  onError,
  pose,
  speechText,
  hasSegments = false,
  fullscreen = false,
  onPrev = () => {},
  onNext = () => {},
}: VRMCanvasProps) {
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
          {/* 左ドラッグ=回転 / 右ドラッグ=パン。ズームは WheelTrackController で割り当てる。 */}
          <OrbitControls ref={controlsRef} enablePan enableZoom={false} target={[0, 1.1, 0]} />
          <CanvasContextMenuSuppressor />
          <WheelTrackController controlsRef={controlsRef} hasSegments={hasSegments} onPrev={onPrev} onNext={onNext} />
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
