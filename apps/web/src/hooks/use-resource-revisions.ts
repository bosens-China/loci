import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import {
  RESOURCE_REVISION_KEYS,
  type ResourceRevisionKey,
  type ResourceRevisions
} from '@loci/shared'
import { getResourceRevisions } from '@/api/revisions'

const RESOURCE_QUERY_KEYS = {
  sources: [['sources']],
  documents: [['documents'], ['document']],
  jobs: [['jobs']],
  settings: [['settings']]
} satisfies Record<ResourceRevisionKey, readonly QueryKey[]>

/** 轮询轻量 revision，并只失效由其他入口实际修改的业务 Query。 */
export function useResourceRevisions(): void {
  const queryClient = useQueryClient()
  const previous = useRef<ResourceRevisions | undefined>(undefined)
  const revisions = useQuery({
    queryKey: ['resource-revisions'],
    queryFn: getResourceRevisions,
    refetchInterval: 1_000,
    refetchOnWindowFocus: 'always'
  })

  useEffect(() => {
    if (!revisions.data) return
    const changedQueryKeys = getChangedResourceQueryKeys(previous.current, revisions.data)
    previous.current = revisions.data
    for (const queryKey of changedQueryKeys) {
      void queryClient.invalidateQueries({ queryKey })
    }
  }, [queryClient, revisions.data])
}

export function getChangedResourceQueryKeys(
  previous: ResourceRevisions | undefined,
  current: ResourceRevisions
): QueryKey[] {
  if (!previous) return []
  return RESOURCE_REVISION_KEYS.flatMap((resource) =>
    previous[resource] === current[resource] ? [] : RESOURCE_QUERY_KEYS[resource]
  )
}
