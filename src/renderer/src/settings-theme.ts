import { useEffect, useState } from 'react'
import type { ThemeMode } from '@shared/api'

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): 'light' | 'dark' {
  return mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode
}

export function useResolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  const [media] = useState(() => window.matchMedia('(prefers-color-scheme: dark)'))
  const [prefersDark, setPrefersDark] = useState(media.matches)
  useEffect(() => {
    const update = (event: MediaQueryListEvent): void => setPrefersDark(event.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [media])
  return resolveTheme(mode, prefersDark)
}
