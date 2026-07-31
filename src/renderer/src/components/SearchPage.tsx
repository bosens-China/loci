import { Alert, Button, Empty, Input, List, Spin, Tag, Typography } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentItem } from '../types'

interface SearchPageProps {
  initialQuery: string
  onSearch: (query: string) => Promise<DocumentItem[]>
  onOpenDocument: (document: DocumentItem) => void
}

function SearchPage({
  initialQuery,
  onSearch,
  onOpenDocument
}: SearchPageProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [results, setResults] = useState<DocumentItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  const search = useCallback(
    async (value: string): Promise<void> => {
      const normalizedQuery = value.trim()
      const currentRequestId = ++requestId.current
      setQuery(value)
      setSubmittedQuery(normalizedQuery)
      setError(null)
      setResults([])

      if (!normalizedQuery) return

      setLoading(true)
      try {
        const items = await onSearch(normalizedQuery)
        if (currentRequestId === requestId.current) setResults(items)
      } catch (searchError: unknown) {
        if (currentRequestId === requestId.current) {
          setError(searchError instanceof Error ? searchError.message : '本地文档搜索失败，请重试')
        }
      } finally {
        if (currentRequestId === requestId.current) setLoading(false)
      }
    },
    [onSearch]
  )

  useEffect(() => {
    let active = true
    void Promise.resolve().then(async () => {
      if (active) await search(initialQuery)
    })
    return () => {
      active = false
      requestId.current += 1
    }
  }, [initialQuery, search])

  const handleQueryChange = (value: string): void => {
    requestId.current += 1
    setQuery(value)
    setSubmittedQuery('')
    setResults([])
    setError(null)
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Typography.Title level={2}>全文搜索</Typography.Title>
      <Typography.Paragraph type="secondary">
        搜索标题和 Markdown 正文，结果来自本地 FTS5 索引。
      </Typography.Paragraph>
      <Input.Search
        size="large"
        autoFocus
        placeholder="输入关键词并按 Enter"
        value={query}
        onChange={(event) => handleQueryChange(event.target.value)}
        onSearch={(value) => void search(value)}
        allowClear
      />

      <div className="mt-6">
        {error && (
          <Alert
            type="error"
            showIcon
            message={error}
            action={
              <Button size="small" onClick={() => void search(submittedQuery)}>
                重试
              </Button>
            }
          />
        )}
        {loading && (
          <div className="flex justify-center py-12">
            <Spin />
          </div>
        )}
        {!loading && !error && !submittedQuery && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="输入关键词开始搜索" />
        )}
        {!loading && !error && submittedQuery && results.length === 0 && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的本地文档" />
        )}
        {!loading && results.length > 0 && (
          <List
            bordered
            dataSource={results}
            renderItem={(document) => (
              <List.Item extra={<Tag>{document.language}</Tag>}>
                <List.Item.Meta
                  title={
                    <Button type="link" className="p-0" onClick={() => onOpenDocument(document)}>
                      {document.title}
                    </Button>
                  }
                  description={
                    <Typography.Text type="secondary">
                      {document.folder} · {document.url}
                    </Typography.Text>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </div>
    </div>
  )
}

export default SearchPage
