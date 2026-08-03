import { createContext, useContext } from 'react'
import type { AppSettings, AppSettingsState } from '@shared/api'

export interface SettingsContextValue {
  state: AppSettingsState
  loading: boolean
  save: (settings: AppSettings) => Promise<AppSettingsState>
  reload: () => Promise<AppSettingsState>
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useAppSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('设置上下文尚未初始化')
  return context
}
