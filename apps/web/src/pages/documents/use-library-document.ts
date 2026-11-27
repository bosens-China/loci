import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { App } from 'antd'
import { ApiError } from '@/api/client'
import { getDocument } from '@/api/documents'

/** 单篇阅读获取完整正文；失效的历史链接同时从 URL 和该库的阅读记忆中移除。 */
export function useLibraryDocument(
  libraryId: string,
  fileId: string | undefined,
  forgetFile: (libraryId: string, fileId: string) => void
) {
  const { message } = App.useApp()
  const query = useQuery({
    queryKey: ['library-file', libraryId, fileId],
    enabled: Boolean(fileId),
    queryFn: async () => {
      if (!fileId) return null
      try {
        const document = await getDocument(fileId)
        return document.sourceId === libraryId ? document : null
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }
    }
  })
  useEffect(() => {
    if (fileId && query.data === null) {
      forgetFile(libraryId, fileId)
      void message.info('该文档已删除或不属于当前文档库，请重新选择。')
    }
  }, [fileId, forgetFile, libraryId, message, query.data])
  return query
}
