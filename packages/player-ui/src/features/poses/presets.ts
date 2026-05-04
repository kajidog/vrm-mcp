import { type VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import { Euler, Quaternion } from 'three'

// 各プリセットは毎フレーム呼ばれて関与ボーンのみ書き換える。
// 切替時に前ポーズの残骸を残さないよう、apply* の冒頭で関与する全ボーンを identity に戻す。
// 正規化ボーン（getNormalizedBoneNode）を使うことでモデル間の bind pose 差を吸収する。

// 関与ボーン一覧（リセット対象）。指は動かさない（多くの VRM で精度が低いため）。
const POSE_BONES: VRMHumanBoneName[] = [
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.UpperChest,
  VRMHumanBoneName.Neck,
  VRMHumanBoneName.Head,
  VRMHumanBoneName.LeftShoulder,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.LeftHand,
  VRMHumanBoneName.RightShoulder,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.RightLowerArm,
  VRMHumanBoneName.RightHand,
]

// 毎フレーム new しないように使い回す。
const _euler = new Euler()
const _quat = new Quaternion()

function resetBones(vrm: VRM): void {
  for (const name of POSE_BONES) {
    const bone = vrm.humanoid.getNormalizedBoneNode(name)
    if (bone) bone.quaternion.identity()
  }
}

function setRot(vrm: VRM, name: VRMHumanBoneName, x: number, y: number, z: number): void {
  const bone = vrm.humanoid.getNormalizedBoneNode(name)
  if (!bone) return
  _euler.set(x, y, z, 'XYZ')
  _quat.setFromEuler(_euler)
  bone.quaternion.copy(_quat)
}

// 自然な腕下げ角度（T-pose から肩を下方向に倒す）。VRM 1.0 正規化ボーンでは Z 回転で arms-down になる。
const ARM_DOWN_Z = Math.PI / 2.6

function applyNeutral(vrm: VRM, _t: number): void {
  resetBones(vrm)
  // 腕を体側へ降ろす（A-pose 寄り）。
  setRot(vrm, VRMHumanBoneName.LeftUpperArm, 0, 0, ARM_DOWN_Z)
  setRot(vrm, VRMHumanBoneName.RightUpperArm, 0, 0, -ARM_DOWN_Z)
}

function applyIdle(vrm: VRM, t: number): void {
  applyNeutral(vrm, t)
  // 呼吸：胸を ±2.5 度の sin で揺らす。0.6 Hz 程度（period ≈ 1.6 s）。
  const breath = Math.sin(t * Math.PI * 1.2) * 0.04
  const sway = Math.sin(t * Math.PI * 0.5) * 0.015
  setRot(vrm, VRMHumanBoneName.Chest, breath, 0, 0)
  setRot(vrm, VRMHumanBoneName.Spine, breath * 0.5, sway, 0)
  // 頭の小さなノイズ（覗き込みすぎないよう微小）。
  setRot(vrm, VRMHumanBoneName.Head, 0, sway * 0.6, 0)
}

function applyWave(vrm: VRM, t: number): void {
  resetBones(vrm)
  setRot(vrm, VRMHumanBoneName.LeftUpperArm, 0, 0, ARM_DOWN_Z)
  // 右腕を持ち上げる。neutral では Z=-ARM_DOWN_Z で腕が下がるので、+Z に振って上げる。
  // 顔の横あたりで手のひらを見せる角度。
  setRot(vrm, VRMHumanBoneName.RightUpperArm, 0, 0, Math.PI * 0.45)
  // 肘を少し曲げて手を頭の横へ。
  setRot(vrm, VRMHumanBoneName.RightLowerArm, 0, -0.5, 0)
  // 手首を左右に揺らして「振る」動作。
  const swing = Math.sin(t * Math.PI * 3) * 0.5
  setRot(vrm, VRMHumanBoneName.RightHand, 0, 0, swing)
}

function applyBow(vrm: VRM, _t: number): void {
  resetBones(vrm)
  // 上半身を前に倒す。X- が前方向のお辞儀（X+ は背反らし）。spine + chest で分割。
  setRot(vrm, VRMHumanBoneName.Spine, -0.35, 0, 0)
  setRot(vrm, VRMHumanBoneName.Chest, -0.15, 0, 0)
  // 頭は逆方向に少し戻して顎を引く感じ。
  setRot(vrm, VRMHumanBoneName.Head, 0.1, 0, 0)
  setRot(vrm, VRMHumanBoneName.LeftUpperArm, 0, 0, ARM_DOWN_Z * 0.85)
  setRot(vrm, VRMHumanBoneName.RightUpperArm, 0, 0, -ARM_DOWN_Z * 0.85)
}

function applyPoint(vrm: VRM, _t: number): void {
  resetBones(vrm)
  setRot(vrm, VRMHumanBoneName.LeftUpperArm, 0, 0, ARM_DOWN_Z)
  // 右腕を前方水平へ：X+ で前方向に肩を倒し、Z で水平に保つ。
  setRot(vrm, VRMHumanBoneName.RightUpperArm, Math.PI * 0.4, 0, -Math.PI * 0.45)
  setRot(vrm, VRMHumanBoneName.RightLowerArm, 0, -0.2, 0)
}

function applyThink(vrm: VRM, t: number): void {
  resetBones(vrm)
  setRot(vrm, VRMHumanBoneName.LeftUpperArm, 0, 0, ARM_DOWN_Z)
  // 右腕を少し前へ + 肘を深く曲げて、手を顎付近へ。
  setRot(vrm, VRMHumanBoneName.RightUpperArm, Math.PI * 0.2, 0, -Math.PI * 0.45)
  setRot(vrm, VRMHumanBoneName.RightLowerArm, 0, -1.6, 0)
  setRot(vrm, VRMHumanBoneName.RightHand, 0, 0, -0.3)
  // 軽く首を前&横に傾げる（X- が前傾）。微小揺らぎで生っぽくする。
  const tilt = 0.1 + Math.sin(t * Math.PI * 0.6) * 0.03
  setRot(vrm, VRMHumanBoneName.Neck, -0.05, 0, tilt)
  setRot(vrm, VRMHumanBoneName.Head, -0.05, 0, tilt)
}

function applyCheer(vrm: VRM, t: number): void {
  resetBones(vrm)
  // 両腕を万歳。小さく上下に揺らす。
  const bounce = Math.sin(t * Math.PI * 4) * 0.08
  setRot(vrm, VRMHumanBoneName.LeftUpperArm, 0, 0, Math.PI * 0.95 + bounce)
  setRot(vrm, VRMHumanBoneName.RightUpperArm, 0, 0, -Math.PI * 0.95 - bounce)
  setRot(vrm, VRMHumanBoneName.LeftLowerArm, 0, 0.2, 0)
  setRot(vrm, VRMHumanBoneName.RightLowerArm, 0, -0.2, 0)
  setRot(vrm, VRMHumanBoneName.Head, -0.1, 0, 0)
}

export interface PosePreset {
  readonly kind: 'preset'
  readonly label: string
  readonly applyToVrm: (vrm: VRM, t: number) => void
}

export const POSE_PRESETS = {
  idle: { kind: 'preset', label: '待機', applyToVrm: applyIdle },
  neutral: { kind: 'preset', label: 'ニュートラル', applyToVrm: applyNeutral },
  wave: { kind: 'preset', label: '手を振る', applyToVrm: applyWave },
  bow: { kind: 'preset', label: 'お辞儀', applyToVrm: applyBow },
  point: { kind: 'preset', label: '指差し', applyToVrm: applyPoint },
  think: { kind: 'preset', label: '考え中', applyToVrm: applyThink },
  cheer: { kind: 'preset', label: '喜び', applyToVrm: applyCheer },
} as const satisfies Record<string, PosePreset>

export type PosePresetId = keyof typeof POSE_PRESETS

export const DEFAULT_POSE_ID: PosePresetId = 'idle'
