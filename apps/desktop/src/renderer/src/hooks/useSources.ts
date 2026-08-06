import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../query-client'
import type { CreateSourceInput, CrawlProgress, DocumentSource, UpdateSourceInput } from '../types'

interface SourcesState {
  sources: DocumentSource[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  create: (input: CreateSourceInput) => Promise<void>
  update: (id: string, input: UpdateSourceInput) => Promise<void>
  remove: (id: string) => Promise<void>
  crawl: (id: string) => Promise<CrawlProgress>
}

export function useSources(): SourcesState {
  const client = useQueryClient()
  const query = useQuery({ queryKey: queryKeys.sources, queryFn: window.api.listSources })
  const createMutation = useMutation({
    mutationFn: window.api.createSource,
    onSuccess: (source) =>
      client.setQueryData<DocumentSource[]>(queryKeys.sources, (current = []) => [
        ...current,
        source
      ])
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSourceInput }) =>
      window.api.updateSource(id, input),
    onSuccess: (source) =>
      client.setQueryData<DocumentSource[]>(queryKeys.sources, (current = []) =>
        current.map((item) => (item.id === source.id ? source : item))
      )
  })
  const removeMutation = useMutation({
    mutationFn: window.api.deleteSource,
    onSuccess: (_, id) =>
      client.setQueryData<DocumentSource[]>(queryKeys.sources, (current = []) =>
        current.filter((source) => source.id !== id)
      )
  })
  const crawlMutation = useMutation({
    mutationFn: window.api.crawlSource,
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.localData })
  })

  return {
    sources: query.data ?? [],
    loading: query.isPending,
    error: query.isError ? '本地文档源加载失败，请重试' : null,
    reload: async () => void (await query.refetch()),
    create: async (input) => void (await createMutation.mutateAsync(input)),
    update: async (id, input) => void (await updateMutation.mutateAsync({ id, input })),
    remove: async (id) => void (await removeMutation.mutateAsync(id)),
    crawl: (id) => crawlMutation.mutateAsync(id)
  }
}
