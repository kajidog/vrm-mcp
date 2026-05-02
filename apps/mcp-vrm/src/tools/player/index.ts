import { registerPlayerUITools } from '../player-ui-tools.js'
import type { ToolDeps } from '../types.js'
import { registerPlayerResource } from './resource.js'
import { createPlayerRuntime, playerResourceUri } from './runtime.js'
import { registerSpeakPlayerTool } from './speak-player-tool.js'

export function registerPlayerTools(deps: ToolDeps): void {
  // Player関連の共有依存（APIクライアント、キャッシュ、スピーカー解決）を集約。
  const runtime = createPlayerRuntime(deps)

  // UIリソースと公開ツールを登録。
  registerPlayerResource(deps)
  registerSpeakPlayerTool(deps, runtime)

  // App UI専用の内部ツール群に shared 依存を注入する。
  registerPlayerUITools(deps, {
    playerEngine: runtime.playerEngine,
    playerResourceUri,
    synthesizeWithCache: runtime.synthesizeWithCache,
    setSessionState: runtime.setSessionState,
    getSessionState: runtime.getSessionStateByKey,
    getSpeakerList: runtime.getSpeakerList,
  })
}
