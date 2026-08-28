import type { ThemeMode } from '@loci/shared'

const THEME_STORAGE_KEY = 'loci_theme_mode'

/** 从 LocalStorage 读取缓存的主题偏好设置 */
export function getStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto'
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'auto') {
      return stored
    }
  } catch {
    // 忽略隐私模式或无权访问 LocalStorage 的异常
  }
  return 'auto'
}

/** 持久化主题偏好至 LocalStorage */
export function setStoredThemeMode(mode: ThemeMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // 忽略写入异常
  }
}

/** 将用户偏好统一解析为 Ant Design 实际使用的浅深色模式。 */
export function resolveThemeMode(mode: ThemeMode, systemPrefersDark: boolean): 'light' | 'dark' {
  if (mode === 'auto') return systemPrefersDark ? 'dark' : 'light'
  return mode
}
