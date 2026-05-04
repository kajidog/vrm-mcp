import type { POSE_PRESETS } from './presets'

// Phase 4 ではプリセットのみだが、Phase 6 で VRMA を足せるよう discriminated union にしておく。
// 'preset' のときは presetId が POSE_PRESETS のキーに制約される。
export type PoseId = keyof typeof POSE_PRESETS

export type Pose =
  | { id: string; kind: 'preset'; presetId: PoseId }
  | { id: string; kind: 'vrma'; modelId: string; vrmaResourceUri: string }
