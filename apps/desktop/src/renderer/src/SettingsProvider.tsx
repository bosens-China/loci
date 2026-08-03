import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { DEFAULT_APP_SETTINGS, type AppSettingsState } from '@shared/api'
import { SettingsContext, type SettingsContextValue } from './settings-context'

const initialState: AppSettingsState = {
  settings: DEFAULT_APP_SETTINGS,
  mcp: {
    running: false,
    endpoint: `http://127.0.0.1:${DEFAULT_APP_SETTINGS.mcpPort}/mcp`,
    error: null
  }
}

function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState(initialState)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async (): Promise<AppSettingsState> => {
    const value = await window.api.getSettings()
    setState(value)
    return value
  }, [])

  useEffect(() => {
    let active = true
    void window.api
      .getSettings()
      .then((value) => {
        if (active) setState(value)
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const value = useMemo<SettingsContextValue>(
    () => ({
      state,
      loading,
      reload,
      save: async (settings) => {
        const saved = await window.api.saveSettings(settings)
        setState(saved)
        return saved
      }
    }),
    [loading, reload, state]
  )
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export default SettingsProvider
