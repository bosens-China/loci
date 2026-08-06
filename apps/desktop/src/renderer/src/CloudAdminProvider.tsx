import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { CloudAdminLoginInput, CloudAdminSession } from '@loci/shared'
import { CloudAdminContext, type CloudAdminContextValue } from './cloud-admin-context'
import { queryKeys } from './query-client'

export function CloudAdminProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.cloudAdminSession,
    queryFn: window.api.getCloudAdminSession
  })
  const loginMutation = useMutation({
    mutationFn: (input: CloudAdminLoginInput) => window.api.cloudAdminLogin(input),
    onSuccess: (session) => client.setQueryData(queryKeys.cloudAdminSession, session)
  })
  const logoutMutation = useMutation({
    mutationFn: window.api.cloudAdminLogout,
    onSettled: () => {
      client.setQueryData<CloudAdminSession | null>(queryKeys.cloudAdminSession, null)
      client.removeQueries({ queryKey: queryKeys.cloudSyncJobs })
    }
  })

  const value = useMemo<CloudAdminContextValue>(
    () => ({
      session: query.data ?? null,
      loading: query.isPending,
      login: (input) => loginMutation.mutateAsync(input),
      logout: async () => void (await logoutMutation.mutateAsync())
    }),
    [loginMutation, logoutMutation, query.data, query.isPending]
  )
  return <CloudAdminContext.Provider value={value}>{children}</CloudAdminContext.Provider>
}
