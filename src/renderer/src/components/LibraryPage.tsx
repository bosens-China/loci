import { BookOutlined, FileTextOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Input,
  Row,
  Select,
  Skeleton,
  Space,
  Tag,
  Tree,
  Typography
} from 'antd'
import ReactMarkdown from 'react-markdown'
import { useDeferredValue, useState, type ReactNode } from 'react'
import type { DocumentItem, DocumentSource } from '../types'
import { buildDocumentTree, filterDocumentsByMarkdown } from './documentTree'

interface LibraryPageProps {
  sources: DocumentSource[]
  documents: DocumentItem[]
  loading: boolean
  error: string | null
  sourceId: string
  selectedDocumentId: string
  onSourceChange: (sourceId: string) => void
  onDocumentSelect: (documentId: string) => void
  onRetry: () => void
}

const markdownComponents = {
  h1: ({ children }: { children?: ReactNode }) => (
    <Typography.Title level={1}>{children}</Typography.Title>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <Typography.Title level={2}>{children}</Typography.Title>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <Typography.Title level={3}>{children}</Typography.Title>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <Typography.Title level={4}>{children}</Typography.Title>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <Typography.Paragraph>{children}</Typography.Paragraph>
  ),
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <Typography.Link href={href} target="_blank" rel="noreferrer">
      {children}
    </Typography.Link>
  ),
  ul: ({ children }: { children?: ReactNode }) => <ul className="list-disc pl-6">{children}</ul>,
  ol: ({ children }: { children?: ReactNode }) => <ol className="list-decimal pl-6">{children}</ol>,
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="overflow-x-auto">{children}</pre>
  ),
  code: ({ children }: { children?: ReactNode }) => (
    <Typography.Text code>{children}</Typography.Text>
  ),
  img: () => null
}

function LibraryPage({
  sources,
  documents,
  loading,
  error,
  sourceId,
  selectedDocumentId,
  onSourceChange,
  onDocumentSelect,
  onRetry
}: LibraryPageProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const visibleDocuments =
    sourceId === 'all' ? documents : documents.filter((document) => document.sourceId === sourceId)
  const filteredDocuments = filterDocumentsByMarkdown(visibleDocuments, deferredQuery)
  const selectedDocument =
    filteredDocuments.find((document) => document.id === selectedDocumentId) ?? filteredDocuments[0]
  const treeData = buildDocumentTree(filteredDocuments)
  const sourceOptions = [
    { value: 'all', label: `全部文档源（${documents.length} 页）` },
    ...sources.map((source) => ({
      value: source.id,
      label: `${source.name}（${source.pages} 页）`
    }))
  ]
  const expandedSourceKeys = [
    ...new Set(filteredDocuments.map((document) => `source:${document.sourceId}`))
  ]

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Typography.Title level={2}>知识库</Typography.Title>
          <Typography.Paragraph type="secondary">
            从 URL 结构浏览本地文档，或按 Markdown 正文关键词过滤文档树。
          </Typography.Paragraph>
        </div>
        <Select
          className="w-64"
          value={sourceId}
          options={sourceOptions}
          onChange={onSourceChange}
          aria-label="按文档源筛选"
        />
      </div>
      {error && (
        <Alert
          className="mb-4"
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          }
        />
      )}
      {loading && (
        <Card variant="borderless">
          <Skeleton active paragraph={{ rows: 8 }} />
        </Card>
      )}
      {!loading && !error && visibleDocuments.length === 0 && (
        <Card variant="borderless">
          <Empty description="还没有收录页面，请先更新一个文档源" />
        </Card>
      )}
      {!loading && !error && visibleDocuments.length > 0 && (
        <Row gutter={16} className="min-h-[480px] items-start">
          <Col xs={24} lg={8} className="flex">
            <Card
              title={
                <>
                  <BookOutlined /> 文档树
                </>
              }
              className="sticky top-0 flex! h-[calc(100vh-48px)] w-full flex-col!"
              styles={{
                body: {
                  display: 'flex',
                  flex: 1,
                  minHeight: 0,
                  flexDirection: 'column',
                  overflow: 'hidden'
                }
              }}
            >
              <Input.Search
                allowClear
                value={query}
                placeholder="搜索 Markdown 正文"
                aria-label="按 Markdown 正文搜索文档树"
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
                {filteredDocuments.length > 0 ? (
                  <Tree
                    key={`${sourceId}:${deferredQuery.trim()}`}
                    blockNode
                    defaultExpandAll={Boolean(deferredQuery.trim())}
                    defaultExpandedKeys={expandedSourceKeys}
                    treeData={treeData}
                    selectedKeys={selectedDocument ? [selectedDocument.id] : []}
                    onSelect={(keys) => {
                      const key = String(keys[0] ?? '')
                      if (filteredDocuments.some((document) => document.id === key))
                        onDocumentSelect(key)
                    }}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有正文匹配的页面" />
                )}
              </div>
            </Card>
          </Col>
          <Col xs={24} lg={16}>
            <Card className="h-full">
              {selectedDocument ? (
                <div>
                  <Typography.Text type="secondary">{selectedDocument.folder}</Typography.Text>
                  <Typography.Title level={3}>{selectedDocument.title}</Typography.Title>
                  <Typography.Link href={selectedDocument.url} target="_blank" rel="noreferrer">
                    {selectedDocument.url}
                  </Typography.Link>
                  <Divider />
                  <Space size="middle" wrap>
                    <Typography.Text type="secondary">
                      <FileTextOutlined /> 最近更新于 {selectedDocument.updatedAt}
                    </Typography.Text>
                    <Tag color="success">{selectedDocument.language}</Tag>
                  </Space>
                  <Divider />
                  <ReactMarkdown components={markdownComponents}>
                    {selectedDocument.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <Empty description="没有正文匹配的页面" />
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  )
}

export default LibraryPage
