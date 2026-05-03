import type { App } from '@modelcontextprotocol/ext-apps'
import type { VrmPayload } from '../types'

interface TextContent {
  type: 'text'
  text: string
}

// CallToolResult の content 配列から最初の text コンテンツを取り出す。
function getTextPayload(content: unknown): string | null {
  if (!Array.isArray(content)) return null
  const textContent = content.find((c) => (c as { type?: string }).type === 'text') as TextContent | undefined
  return textContent?.type === 'text' ? textContent.text : null
}

// isError=true の場合は text コンテンツをエラーメッセージとして送出する。
function assertNoToolError(result: { isError?: boolean; content?: unknown }): void {
  if (!result.isError) return
  const payload = getTextPayload(result.content)
  throw new Error(payload ?? 'Tool call failed')
}

/**
 * サーバ側の `_resolve_default_vrm_for_player` を叩き、デフォルト VRM を取得する。
 *
 * 戻り値:
 *   { source: 'registry', metadata, vrmBase64, vrmMimeType }
 *   { source: 'config',   vrmBase64, vrmMimeType, sourcePath }
 *   { source: 'none' }
 *
 * `source: 'none'` または vrmBase64 が無い場合は null を返し、UI は空表示にする。
 */
export async function fetchDefaultVrmOnServer(app: App): Promise<VrmPayload | null> {
  const result = await app.callServerTool({
    name: '_resolve_default_vrm_for_player',
    arguments: {},
  })
  assertNoToolError(result)

  const payload = getTextPayload(result.content)
  if (!payload) return null

  const parsed = JSON.parse(payload) as {
    source?: 'registry' | 'config' | 'none'
    vrmBase64?: string
    vrmMimeType?: string
  }

  if (parsed.source === 'none' || !parsed.vrmBase64) return null
  return {
    vrmBase64: parsed.vrmBase64,
    vrmMimeType: parsed.vrmMimeType ?? 'model/gltf-binary',
  }
}
