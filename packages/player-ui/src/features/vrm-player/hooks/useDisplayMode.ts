import type { App, McpUiDisplayMode } from '@modelcontextprotocol/ext-apps'
import { useEffect, useState } from 'react'

export function useDisplayMode(app: App | null) {
  const [displayMode, setDisplayMode] = useState<McpUiDisplayMode>('inline')
  const [availableDisplayModes, setAvailableDisplayModes] = useState<McpUiDisplayMode[]>([])

  useEffect(() => {
    if (!app) return

    const applyHostContext = () => {
      const context = app.getHostContext()
      setDisplayMode(context?.displayMode ?? 'inline')
      setAvailableDisplayModes(context?.availableDisplayModes ?? [])
    }

    const previousHandler = app.onhostcontextchanged
    app.onhostcontextchanged = (context) => {
      previousHandler?.(context)
      applyHostContext()
    }
    applyHostContext()

    return () => {
      app.onhostcontextchanged = previousHandler
    }
  }, [app])

  useEffect(() => {
    if (!app || displayMode !== 'fullscreen') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void app.requestDisplayMode({ mode: 'inline' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [app, displayMode])

  const requestDisplayMode = async (mode: McpUiDisplayMode) => {
    if (!app) return
    const context = app.getHostContext()
    if (!context?.availableDisplayModes?.includes(mode)) return
    const result = await app.requestDisplayMode({ mode })
    setDisplayMode(result.mode)
  }

  return {
    displayMode,
    availableDisplayModes,
    canFullscreen: availableDisplayModes.includes('fullscreen'),
    requestFullscreen: () => requestDisplayMode('fullscreen'),
    requestInline: () => requestDisplayMode('inline'),
  }
}
