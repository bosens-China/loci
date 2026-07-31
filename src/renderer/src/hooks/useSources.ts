import { useCallback, useEffect, useState } from 'react'
import type {
  CreateSourceInput,
  CrawlProgress,
  DocumentSource,
  UpdateSourceInput
} from '@renderer/types'

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
  const [sources, setSources] = useState<DocumentSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setSources(await window.api.listSources())
      setError(null)
    } catch {
      setError('本地文档源加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(reload)
  }, [reload])

  const create = useCallback(async (input: CreateSourceInput): Promise<void> => {
    const source = await window.api.createSource(input)
    setSources((current) => [...current, source])
  }, [])

  const update = useCallback(async (id: string, input: UpdateSourceInput): Promise<void> => {
    const source = await window.api.updateSource(id, input)
    setSources((current) => current.map((item) => (item.id === id ? source : item)))
  }, [])

  const remove = useCallback(async (id: string): Promise<void> => {
    await window.api.deleteSource(id)
    setSources((current) => current.filter((source) => source.id !== id))
  }, [])

  const crawl = useCallback(
    async (id: string): Promise<CrawlProgress> => {
      try {
        return await window.api.crawlSource(id)
      } finally {
        await reload()
      }
    },
    [reload]
  )

  return { sources, loading, error, reload, create, update, remove, crawl }
}
