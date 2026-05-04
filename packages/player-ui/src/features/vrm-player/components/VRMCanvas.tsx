import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import type { PosePresetId } from '../../poses/presets'
import type { VrmSource } from '../types'
import { VRMScene } from './VRMScene'

interface VRMCanvasProps {
  // null のときはモデル無しの空シーンを描画する（背景・ライト・グリッドのみ）。
  source: VrmSource | null
  onError: (message: string) => void
  pose?: PosePresetId
}

/**
 * three.js のキャンバスとシーン構成（背景・ライト・グリッド・カメラ操作）を担当。
 * モデルそのものの読み込みは `VRMScene` 側に委譲する。
 */
export function VRMCanvas({ source, onError, pose }: VRMCanvasProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-surface)]">
      <div className="h-[360px] w-full">
        <Canvas
          camera={{ position: [0, 1.35, 2.2], fov: 28 }}
          // 高 DPI 端末でも上限を 1.5 にして描画コストを抑える。
          dpr={[1, 1.5]}
          gl={{
            antialias: false,
            powerPreference: 'high-performance',
          }}
        >
          <color attach="background" args={['#f3f4f6']} />
          <ambientLight intensity={1.2} />
          <directionalLight position={[1.5, 2.5, 2]} intensity={1.5} />
          <directionalLight position={[-1, 1.5, -1]} intensity={0.5} />
          <gridHelper args={[6, 12, '#d4d4d8', '#e4e4e7']} position={[0, -1, 0]} />
          {source ? <VRMScene source={source} onError={onError} pose={pose} /> : null}
          {/* パン無効＋頭の高さあたりを注視点に。OrbitControls は座標 (0, 1.1, 0) を中心に回転。 */}
          <OrbitControls enablePan={false} target={[0, 1.1, 0]} />
        </Canvas>
      </div>
      <div className="border-t border-[var(--ui-border)] px-3 py-2 text-xs text-[var(--ui-text-secondary)]">
        {source?.note ?? 'マウスで回転できます'}
      </div>
    </div>
  )
}
