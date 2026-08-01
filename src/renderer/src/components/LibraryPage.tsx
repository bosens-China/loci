import {
  BookOutlined,
  CheckOutlined,
  CodeOutlined,
  CopyOutlined,
  EyeOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Image,
  Input,
  Row,
  Segmented,
  Select,
  Skeleton,
  Space,
  Tag,
  Tree,
  Typography
} from 'antd'
import { useDeferredValue, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vs, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'
import type { DocumentItem, DocumentSource } from '@renderer/types'
import {
  buildDocumentTree,
  filterDocumentsByMarkdown,
  getAncestorKeysForDocument
} from './documentTree'

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

function detectLanguage(text: string, declaredLanguage?: string): string {
  if (declaredLanguage && declaredLanguage !== 'text' && declaredLanguage !== 'code') {
    return declaredLanguage
  }
  const code = text.trim()
  if (!code) return 'text'

  if (
    (code.startsWith('{') && code.endsWith('}')) ||
    (code.startsWith('[') && code.endsWith(']'))
  ) {
    try {
      JSON.parse(code)
      return 'json'
    } catch {
      // ignore
    }
  }

  if (/^<[a-z1-6]+/i.test(code) && /<\/[a-z1-6]+>/i.test(code)) {
    return 'html'
  }

  if (/^(npm|pnpm|yarn|npx|git|cd|docker|curl|chmod)\s/m.test(code)) {
    return 'bash'
  }

  if (/^\s*(def\s+\w+|import\s+\w+|from\s+\w+\s+import|class\s+\w+:)/m.test(code)) {
    return 'python'
  }

  if (
    /export\s+default|import\s+.*from|const\s+\w+|let\s+\w+|var\s+\w+|function\s*\(|\bconsole\.log\b|\bmodule\.exports\b|\{/m.test(
      code
    )
  ) {
    return 'javascript'
  }

  return 'javascript'
}

function CodeBlock({ language, value }: { language: string; value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const isDark =
    typeof window !== 'undefined' &&
    (document.documentElement.classList.contains('dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  const effectiveLang = detectLanguage(value, language)

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group relative my-4 overflow-hidden rounded-xl border border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] shadow-sm dark:border-[#333333] dark:bg-[#1e1e1e]">
      <div className="flex items-center justify-between border-b border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-tertiary)] px-4 py-2 font-mono text-xs text-[var(--ant-color-text-tertiary)] dark:border-[#333333] dark:bg-[#252526] dark:text-gray-400">
        <div className="flex items-center gap-2">
          <div className="mr-1 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
          </div>
          <span className="rounded bg-[#333333]/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-blue-600 dark:bg-[#333333] dark:text-blue-400">
            {effectiveLang}
          </span>
        </div>
        <Button
          size="small"
          type="text"
          icon={copied ? <CheckOutlined className="text-green-500" /> : <CopyOutlined />}
          className="h-7 text-xs text-[var(--ant-color-text-secondary)] transition-colors hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white"
          onClick={handleCopy}
          aria-label="复制代码块"
        >
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
      <SyntaxHighlighter
        language={effectiveLang}
        style={isDark ? vscDarkPlus : vs}
        customStyle={{
          margin: 0,
          padding: '16px 20px',
          fontSize: '13px',
          lineHeight: '1.7',
          fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
          background: isDark ? '#1e1e1e' : 'transparent'
        }}
        PreTag="div"
      >
        {value}
      </SyntaxHighlighter>
    </div>
  )
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
  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    const match = /language-(\w+)/.exec(className || '')
    const text = String(children ?? '').replace(/\n$/, '')
    if (match || text.includes('\n')) {
      return <CodeBlock language={match ? match[1] : ''} value={text} />
    }
    return <Typography.Text code>{children}</Typography.Text>
  },
  img: ({ src, alt }: { src?: string; alt?: string }) => (
    <Image
      src={src}
      alt={alt ?? '文档图片'}
      className="my-2 max-w-full rounded border border-solid border-[var(--ant-color-border-secondary)]"
    />
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-solid border-[var(--ant-color-border-secondary)]">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className="border-b border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)]">
      {children}
    </thead>
  ),
  tbody: ({ children }: { children?: ReactNode }) => (
    <tbody className="divide-y divide-solid divide-[var(--ant-color-border-secondary)] font-normal">
      {children}
    </tbody>
  ),
  tr: ({ children }: { children?: ReactNode }) => (
    <tr className="transition-colors hover:bg-[var(--ant-color-fill-quaternary)]">{children}</tr>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="px-4 py-2.5 text-xs font-semibold text-[var(--ant-color-text)]">{children}</th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="px-4 py-2 text-xs text-[var(--ant-color-text-secondary)]">{children}</td>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-3 rounded-r border-l-4 border-blue-500 bg-blue-50/20 p-4 py-2 text-sm italic text-[var(--ant-color-text-secondary)] dark:bg-blue-950/20">
      {children}
    </blockquote>
  )
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
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')
  const deferredQuery = useDeferredValue(query)
  const visibleDocuments =
    sourceId === 'all' ? documents : documents.filter((document) => document.sourceId === sourceId)
  const filteredDocuments = filterDocumentsByMarkdown(visibleDocuments, deferredQuery)
  const selectedDocument =
    filteredDocuments.find((document) => document.id === selectedDocumentId) ??
    (filteredDocuments.length > 0 ? filteredDocuments[0] : undefined)

  const treeData = buildDocumentTree(filteredDocuments)
  const sourceOptions = [
    { value: 'all', label: `全部文档源（${documents.length} 页）` },
    ...sources.map((source) => ({
      value: source.id,
      label: `${source.name}（${source.pages} 页）`
    }))
  ]

  // 计算选中文档祖先节点的 Key，用于精准渐进展开
  const expandedAncestorKeys = selectedDocument
    ? getAncestorKeysForDocument(filteredDocuments, selectedDocument.id)
    : []

  return (
    <div className="mx-auto flex h-full w-full max-w-[1440px] flex-col overflow-hidden">
      <div className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-4">
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
          className="mb-4 shrink-0"
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
        <Row gutter={16} className="flex-1 min-h-0 h-full items-stretch">
          <Col xs={24} lg={8} className="h-full">
            <Card
              title={
                <>
                  <BookOutlined /> 文档树
                </>
              }
              className="flex! h-full w-full flex-col!"
              styles={{
                body: {
                  display: 'flex',
                  flex: 1,
                  minHeight: 0,
                  flexDirection: 'column',
                  overflow: 'hidden',
                  padding: '16px'
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
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
                {filteredDocuments.length > 0 ? (
                  <Tree
                    key={`${sourceId}:${deferredQuery.trim()}:${selectedDocument?.id ?? ''}`}
                    showIcon
                    blockNode
                    defaultExpandAll={Boolean(deferredQuery.trim())}
                    defaultExpandedKeys={
                      deferredQuery.trim()
                        ? [...new Set(filteredDocuments.map((doc) => `source:${doc.sourceId}`))]
                        : expandedAncestorKeys
                    }
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
          <Col xs={24} lg={16} className="h-full">
            <Card
              className="flex! h-full w-full flex-col!"
              styles={{
                body: {
                  display: 'flex',
                  flex: 1,
                  minHeight: 0,
                  flexDirection: 'column',
                  overflow: 'hidden',
                  padding: '24px'
                }
              }}
            >
              {selectedDocument ? (
                <div className="flex flex-col h-full min-h-0">
                  {/* 固定头部与控制栏 */}
                  <div className="shrink-0 pb-3 border-b border-b-solid border-b-[var(--ant-color-border-secondary)]">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div className="min-w-0 flex-1">
                        <Typography.Text
                          type="secondary"
                          className="block font-mono text-xs truncate"
                        >
                          {selectedDocument.folder || '根目录'}
                        </Typography.Text>
                        <Typography.Title
                          level={3}
                          className="mb-0! mt-0.5! truncate"
                          title={selectedDocument.title}
                        >
                          {selectedDocument.title}
                        </Typography.Title>
                      </div>
                      <Segmented
                        size="middle"
                        value={viewMode}
                        options={[
                          {
                            label: '渲染视图',
                            value: 'preview',
                            icon: <EyeOutlined className="text-blue-500" />
                          },
                          {
                            label: '源码视图',
                            value: 'source',
                            icon: <CodeOutlined className="text-purple-500" />
                          }
                        ]}
                        onChange={(val) => setViewMode(val as 'preview' | 'source')}
                      />
                    </div>
                    <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                      <Typography.Link
                        href={selectedDocument.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-mono truncate max-w-lg"
                      >
                        {selectedDocument.url}
                      </Typography.Link>
                      <Space size="middle" wrap>
                        <Typography.Text type="secondary" className="text-xs">
                          <FileTextOutlined /> 最近更新于 {selectedDocument.updatedAt}
                        </Typography.Text>
                        <Tag bordered={false} color="success">
                          {selectedDocument.language}
                        </Tag>
                      </Space>
                    </div>
                  </div>

                  {/* 独立可滚动的 Markdown 内容与源码控制体 */}
                  <div className="flex-1 min-h-0 overflow-y-auto pt-4 pr-2">
                    {viewMode === 'preview' ? (
                      <div className="markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {selectedDocument.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between sticky top-0 bg-[var(--ant-color-bg-container)] py-1 z-10">
                          <Typography.Text type="secondary" className="text-xs">
                            Markdown 原始文本（{selectedDocument.content.length} 字符）
                          </Typography.Text>
                          <Typography.Text
                            copyable={{
                              text: selectedDocument.content,
                              tooltips: ['复制 Markdown 源码', '已复制源码']
                            }}
                            className="text-xs text-blue-600 dark:text-blue-400 cursor-pointer"
                          >
                            复制 Markdown 源码
                          </Typography.Text>
                        </div>
                        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-4 font-mono text-xs leading-6 text-[var(--ant-color-text)]">
                          {selectedDocument.content}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Empty description="请从左侧文档树选择一个页面预览" />
                </div>
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  )
}

export default LibraryPage
