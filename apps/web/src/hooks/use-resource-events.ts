import { useEffect, useRef } from 'react'
import type { QueryKey } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import {
  RESOURCE_REVISION_KEYS,
  SERVER_RESOURCE_REVISION_KEYS,
  type BrowserOperationStatus,
  type LocalBrowserStatus,
  type ResourceRevisions,
  type ServerResourceRevisions
} from '@loci/shared'
import { ADMIN_CRAWL_SETTINGS_KEY } from '@/pages/admin/AdminCrawlSettingsPanel'
import { ADMIN_JOBS_KEY, ADMIN_LIBRARIES_KEY } from '@/pages/admin/admin-query-keys'
import { JOBS_QUERY_KEY } from '@/api/jobs'

export const LOCAL_QUERY_KEYS = {
  sources: [['sources']],
  documents: [['documents'], ['document'], ['library-tree'], ['library-file']],
  jobs: [JOBS_QUERY_KEY],
  settings: [['settings']],
  logs: [['operation-logs']]
} satisfies Record<keyof ResourceRevisions, readonly QueryKey[]>

export const SERVER_QUERY_KEYS = {
  libraries: [ADMIN_LIBRARIES_KEY, ['cloud-catalog'], ['library-tree'], ['library-file']],
  jobs: [ADMIN_JOBS_KEY],
  hostnamePolicies: [['admin', 'hostname-policies']],
  crawlSettings: [ADMIN_CRAWL_SETTINGS_KEY],
  auditLogs: [['admin', 'audit-logs']]
} satisfies Record<keyof ServerResourceRevisions, readonly QueryKey[]>

/** AppShell 建立唯一 SSE 连接，事件只让受影响的 React Query 缓存重新读取。 */
export function useResourceEvents(): void {
  const queryClient = useQueryClient()
  const localRevisions = useRef<ResourceRevisions | undefined>(undefined)
  const serverRevisions = useRef<ServerResourceRevisions | undefined>(undefined)

  useEffect(() => {
    const events = new EventSource('/api/events')
    events.addEventListener('local-revisions', (event) => {
      const revisions = parseRevisionPayload<ResourceRevisions>(event, RESOURCE_REVISION_KEYS)
      if (!revisions) return
      invalidateQueryKeys(
        queryClient,
        getChangedQueryKeys(localRevisions.current, revisions, LOCAL_QUERY_KEYS)
      )
      localRevisions.current = revisions
    })
    events.addEventListener('admin-revisions', (event) => {
      const revisions = parseRevisionPayload<ServerResourceRevisions>(
        event,
        SERVER_RESOURCE_REVISION_KEYS
      )
      if (!revisions) return
      invalidateQueryKeys(
        queryClient,
        getChangedQueryKeys(serverRevisions.current, revisions, SERVER_QUERY_KEYS)
      )
      serverRevisions.current = revisions
    })
    events.addEventListener('browser-operation', (event) => {
      const operation = parseBrowserOperation(event)
      if (!operation) return
      queryClient.setQueryData<LocalBrowserStatus>(['local-browser'], (current) =>
        current ? { ...current, operation } : current
      )
      if (operation.state !== 'running') {
        void queryClient.invalidateQueries({ queryKey: ['local-browser'] })
      }
    })
    return () => events.close()
  }, [queryClient])
}

function parseBrowserOperation(event: Event): BrowserOperationStatus | undefined {
  if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(event.data)
    if (!isBrowserOperation(parsed)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function isBrowserOperation(value: unknown): value is BrowserOperationStatus {
  if (typeof value !== 'object' || value === null) return false
  const operation = value as Record<string, unknown>
  return (
    typeof operation.id === 'string' &&
    (operation.kind === 'install' || operation.kind === 'uninstall') &&
    (operation.state === 'running' ||
      operation.state === 'succeeded' ||
      operation.state === 'failed') &&
    typeof operation.phase === 'string' &&
    (typeof operation.progress === 'number' || operation.progress === null) &&
    typeof operation.message === 'string' &&
    typeof operation.startedAt === 'string' &&
    (typeof operation.finishedAt === 'string' || operation.finishedAt === null) &&
    (typeof operation.error === 'string' || operation.error === null)
  )
}

export function parseRevisionPayload<T extends Record<string, number>>(
  event: Event,
  keys: readonly string[]
): T | undefined {
  if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(event.data)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      keys.every((key) => typeof (parsed as Record<string, unknown>)[key] === 'number')
    ) {
      return parsed as T
    }
  } catch {
    return undefined
  }
  return undefined
}

export function getChangedQueryKeys<T extends Record<string, number>>(
  previous: T | undefined,
  current: T,
  groups: Record<string, readonly QueryKey[]>
): QueryKey[] {
  if (!previous) return []
  return Object.keys(groups).flatMap((key) => (previous[key] === current[key] ? [] : groups[key]))
}

function invalidateQueryKeys(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKeys: readonly QueryKey[]
): void {
  for (const queryKey of queryKeys) {
    void queryClient.invalidateQueries({ queryKey })
  }
}
