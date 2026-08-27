import type { ThemeMode } from '@loci/shared'

/** 将用户偏好统一解析为 Ant Design 实际使用的浅深色模式。 */
export function resolveThemeMode(mode: ThemeMode, systemPrefersDark: boolean): 'light' | 'dark' {
  if (mode === 'auto') return systemPrefersDark ? 'dark' : 'light'
  return mode
}
