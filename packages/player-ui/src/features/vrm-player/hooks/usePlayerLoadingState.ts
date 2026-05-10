import { useCallback, useRef, useState } from 'react'
import type { VrmPlayerState } from '../types'

export function usePlayerLoadingState() {
  const [loadingPhase, setLoadingPhase] = useState<VrmPlayerState['loadingPhase']>('idle')
  const [loadingProgress, setLoadingProgress] = useState(0)
  const loadingPhaseRef = useRef<VrmPlayerState['loadingPhase']>('idle')
  const loadingProgressRef = useRef(0)

  const setLoadingState = useCallback((phase: VrmPlayerState['loadingPhase'], progress: number) => {
    const nextProgress = Math.min(100, Math.max(0, Math.round(progress)))
    loadingPhaseRef.current = phase
    loadingProgressRef.current = nextProgress
    setLoadingPhase(phase)
    setLoadingProgress(nextProgress)
  }, [])

  const notifyVrmLoadStart = useCallback(() => {
    const phase = loadingPhaseRef.current
    if (phase === 'ready' || phase === 'preparingAudio' || phase === 'error') return
    setLoadingState('loadingVrm', Math.max(loadingProgressRef.current, 50))
  }, [setLoadingState])

  const notifyVrmLoaded = useCallback(() => {
    const phase = loadingPhaseRef.current
    if (phase === 'loadingVrm' || phase === 'resolvingModel' || phase === 'waitingTool') {
      setLoadingState('ready', 100)
    }
  }, [setLoadingState])

  return {
    loadingPhase,
    loadingProgress,
    setLoadingState,
    notifyVrmLoadStart,
    notifyVrmLoaded,
  }
}
