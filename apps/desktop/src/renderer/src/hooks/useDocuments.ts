import { useCallback, useEffect, useState } from 'react'
import type { DocumentItem } from '@renderer/types'

interface DocumentsState {
  documents: DocumentItem[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

export function useDocuments(): DocumentsState {
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setDocuments(await window.api.listDocuments())
      setError(null)
    } catch {
      setError('本地文档加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(reload)
    return window.api.onExternalDataChange(() => void reload())
  }, [reload])

  return { documents, loading, error, reload }
}
