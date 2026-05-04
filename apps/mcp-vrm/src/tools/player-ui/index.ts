import type { ToolDeps } from '../types.js'
import { registerVrmRegistryTools } from '../vrm-registry/tools.js'
import { createPlayerUIToolContext } from './context.js'
import { registerPlayerSettingsTools } from './player-settings-tools.js'
import { registerPlayerSpeakerTools } from './speaker-tools.js'
import { registerTestSpeakTools } from './test-speak-tools.js'
import type { PlayerUIShared } from './types.js'

export type { PlayerUIShared } from './types.js'

export function registerPlayerUITools(deps: ToolDeps, shared: PlayerUIShared): void {
  // Player UI向けの共通依存を1つのコンテキストにまとめる。
  const context = createPlayerUIToolContext(deps, shared)

  // UIから呼ばれるツール群を機能単位で登録。
  registerPlayerSpeakerTools(context)
  registerPlayerSettingsTools(context)
  registerTestSpeakTools(context)
  registerVrmRegistryTools(context, shared.vrmRegistry)
}
