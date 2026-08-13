import { QueryClient } from '@tanstack/react-query'

export const queryKeys = {
  localData: ['local-data'] as const,
  sources: ['local-data', 'sources'] as const,
  documents: ['local-data', 'documents'] as const,
  settings: ['settings'] as const,
  skills: ['skills'] as const,
  cloudAdminSession: ['cloud-admin-session'] as const,
  cloudSyncJobs: ['cloud-sync-jobs'] as const,
  cloudCatalog: (serverUrl: string) => ['cloud-catalog', serverUrl] as const,
  cloudLibraries: ['cloud-libraries'] as const
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      refetchOnWindowFocus: false,
      retry: false
    },
    mutations: { networkMode: 'always' }
  }
})
