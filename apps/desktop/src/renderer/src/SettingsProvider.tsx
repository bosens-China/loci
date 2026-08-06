import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { DEFAULT_APP_SETTINGS, type AppSettingsState } from '@loci/shared'
import { SettingsContext, type SettingsContextValue } from './settings-context'
import { queryKeys } from './query-client'

const initialState: AppSettingsState = {
  settings: DEFAULT_APP_SETTINGS,
  mcp: {
    running: false,
    endpoint: `http://127.0.0.1:${DEFAULT_APP_SETTINGS.mcpPort}/mcp`,
    error: null
  }
}

function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const client = useQueryClient()
  const query = useQuery({ queryKey: queryKeys.settings, queryFn: window.api.getSettings })
  const saveMutation = useMutation({
    mutationFn: window.api.saveSettings,
    onSuccess: (state) => client.setQueryData(queryKeys.settings, state)
  })
  const state = query.data ?? initialState

  const value = useMemo<SettingsContextValue>(
    () => ({
      state,
      loading: query.isPending,
      reload: async () => (await query.refetch({ throwOnError: true })).data ?? state,
      save: (settings) => saveMutation.mutateAsync(settings)
    }),
    [query, saveMutation, state]
  )
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export default SettingsProvider
