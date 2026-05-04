import { useSyncExternalStore } from 'react'

type ColorScheme = 'light' | 'dark'

const QUERY = '(prefers-color-scheme: dark)'

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

function getSnapshot(): ColorScheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia(QUERY).matches ? 'dark' : 'light'
}

export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'light')
}
