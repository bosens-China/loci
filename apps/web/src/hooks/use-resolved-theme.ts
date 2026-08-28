import { useEffect, useState } from 'react'
import type { ThemeMode } from '@loci/shared'
import { resolveThemeMode, setStoredThemeMode } from '@/utils/theme'

const QUERY = '(prefers-color-scheme: dark)'

function getSystemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(QUERY).matches
}

/** 订阅系统配色变化并同步至 document.documentElement 的 .dark 类与 data-theme 属性。 */
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

  const resolved = resolveThemeMode(mode, systemPrefersDark)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const isDark = resolved === 'dark'
    document.documentElement.classList.toggle('dark', isDark)
    document.documentElement.setAttribute('data-theme', resolved)
    setStoredThemeMode(mode)
  }, [mode, resolved])

  return resolved
}
