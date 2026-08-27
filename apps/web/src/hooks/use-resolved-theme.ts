import { useEffect, useState } from 'react'
import type { ThemeMode } from '@loci/shared'
import { resolveThemeMode } from '@/utils/theme'

const QUERY = '(prefers-color-scheme: dark)'

function getSystemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(QUERY).matches
}

/** 仅在自动模式下订阅系统配色变化，避免页面持有两套主题状态。 */
export function useResolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark)

  useEffect(() => {
    if (mode !== 'auto') return undefined
    const media = window.matchMedia(QUERY)
    const update = (): void => setSystemPrefersDark(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [mode])

  return resolveThemeMode(mode, systemPrefersDark)
}
