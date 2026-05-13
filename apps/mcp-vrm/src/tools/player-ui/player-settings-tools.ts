import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'
import { resolveUserId } from '../auth-context.js'
import { registerAppToolIfEnabled } from '../registration.js'
import type { ToolHandlerExtra } from '../types.js'
import { createErrorResponse } from '../utils.js'
import type { PlayerUIToolContext } from './context.js'

export function registerPlayerSettingsTools(context: PlayerUIToolContext): void {
  const { deps, shared } = context
  const { server, disabledTools } = deps
  const { playerResourceUri, playerSettings } = shared

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_get_player_settings_for_player',
    {
      title: 'Get Player Settings (Player)',
      description: 'Get UI player synthesis overrides and CLI defaults. Only callable from the app UI.',
      _meta: {
        ui: { resourceUri: playerResourceUri, visibility: ['app'] },
      },
    },
    async (_args: Record<string, never>, extra: ToolHandlerExtra): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                overrides: playerSettings.get(userId),
                cliDefaults: playerSettings.getCliDefaults(),
              }),
            },
          ],
        }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )

  registerAppToolIfEnabled(
    server,
    disabledTools,
    '_set_player_settings_for_player',
    {
      title: 'Set Player Settings (Player)',
      description: 'Set UI player synthesis overrides. null resets a single field; reset clears all overrides.',
      inputSchema: {
        speedScale: z.number().nullable().optional(),
        prePhonemeLength: z.number().nullable().optional(),
        postPhonemeLength: z.number().nullable().optional(),
        autoPlay: z.boolean().nullable().optional(),
        usePublicVrms: z.boolean().nullable().optional(),
        activeModelId: z.string().nullable().optional(),
        reset: z.boolean().optional(),
      },
      _meta: {
        ui: { resourceUri: playerResourceUri, visibility: ['app'] },
      },
    },
    async (
      input: {
        speedScale?: number | null
        prePhonemeLength?: number | null
        postPhonemeLength?: number | null
        autoPlay?: boolean | null
        usePublicVrms?: boolean | null
        activeModelId?: string | null
        reset?: boolean
      },
      extra: ToolHandlerExtra
    ): Promise<CallToolResult> => {
      try {
        const userId = resolveUserId(extra)
        const overrides = input.reset
          ? playerSettings.reset(userId)
          : playerSettings.set(
              {
                speedScale: input.speedScale,
                prePhonemeLength: input.prePhonemeLength,
                postPhonemeLength: input.postPhonemeLength,
                autoPlay: input.autoPlay,
                usePublicVrms: input.usePublicVrms,
                activeModelId: input.activeModelId,
              },
              userId
            )
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                overrides,
                cliDefaults: playerSettings.getCliDefaults(),
              }),
            },
          ],
        }
      } catch (error) {
        return createErrorResponse(error)
      }
    }
  )
}
