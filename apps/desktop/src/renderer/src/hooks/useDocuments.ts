import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../query-client'
import type { DocumentItem } from '../types'

interface DocumentsState {
  documents: DocumentItem[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

export function useDocuments(): DocumentsState {
  const query = useQuery({ queryKey: queryKeys.documents, queryFn: window.api.listDocuments })
  return {
    documents: query.data ?? [],
    loading: query.isPending,
    error: query.isError ? '本地文档加载失败，请重试' : null,
    reload: async () => void (await query.refetch())
  }
}
