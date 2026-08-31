import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DocumentRecord } from '@loci/shared'
import {
  BookOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  ExportOutlined,
  FileTextOutlined,
  FolderOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { App, Button, Card, Empty, Skeleton, Space, Tag, Typography } from 'antd'
import { formatBytes, formatDateTime } from '@/utils/format'

export type ReaderDocument = DocumentRecord & {
  contentBytes: number
  contentSizeIsPartial?: boolean
}

interface DocumentReaderPanelProps {
  document: ReaderDocument | null
  libraryTitle?: string
  loading: boolean
  error: Error | null
  onRetry: () => void
}

/** 右侧阅读区：优雅的文档元数据头部、快捷操作栏与 Markdown 正文容器。 */
export function DocumentReaderPanel(props: DocumentReaderPanelProps): React.JSX.Element {
  const { message } = App.useApp()
  const [copied, setCopied] = useState(false)

  const handleCopyMarkdown = async (): Promise<void> => {
    if (!props.document?.content) return
    try {
      await navigator.clipboard.writeText(props.document.content)
      setCopied(true)
      void message.success('Markdown 正文已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      void message.error('复制失败，请手动复制')
    }
  }

  if (props.loading) {
    return (
      <Card className="h-full shadow-xs">
        <Skeleton active paragraph={{ rows: 12 }} />
      </Card>
    )
  }

  if (props.error) {
    return (
      <Card className="h-full flex items-center justify-center shadow-xs">
        <Empty
          description={
            <div className="space-y-2">
              <div className="text-base font-medium text-[var(--ant-color-text)]">
                文档内容加载失败
              </div>
              <p className="text-xs text-[var(--ant-color-text-secondary)]">
                {props.error.message || '请检查本地后台服务连接'}
              </p>
            </div>
          }
        >
          <Button icon={<ReloadOutlined />} type="primary" onClick={props.onRetry}>
            重新加载
          </Button>
        </Empty>
      </Card>
    )
  }

  if (!props.document) {
    return (
      <Card className="h-full flex items-center justify-center shadow-xs text-center">
        <div className="max-w-md py-16 mx-auto">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--ant-color-fill-quaternary)] text-2xl text-[var(--ant-color-primary)] mb-4 shadow-xs">
            <BookOutlined />
          </div>
          <Typography.Title level={4} className="m-0! mb-2">
            选择左侧目录开始离线阅读
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="text-xs leading-relaxed">
            文档已建立离线 SQLite 全文索引，支持层级目录索引、即时搜索与无网离线阅读。
          </Typography.Paragraph>
        </div>
      </Card>
    )
  }

  const formattedCrawledAt = formatDateTime(props.document.updatedAt)
  const crawledAt = formattedCrawledAt === '—' ? props.document.updatedAt : formattedCrawledAt

  return (
    <Card
      styles={{
        body: { padding: 0, height: '100%', display: 'flex', flexDirection: 'column' }
      }}
      className="h-full shadow-xs flex flex-col overflow-hidden border-[var(--ant-color-border-secondary)]"
    >
      {/* 文档详情头部 */}
      <header className="shrink-0 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Typography.Title level={3} className="m-0! text-lg font-bold tracking-tight">
              {props.document.title}
            </Typography.Title>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {props.document.folder && (
                <Tag icon={<FolderOutlined />} className="m-0! font-mono text-xs">
                  {props.document.folder}
                </Tag>
              )}
              {props.document.language && (
                <Tag color="blue" className="m-0! text-xs">
                  {props.document.language}
                </Tag>
              )}
              {props.document.updatedAt && (
                <Tag icon={<ClockCircleOutlined />} className="m-0! text-xs">
                  抓取于 {crawledAt}
                </Tag>
              )}
              <Tag icon={<FileTextOutlined />} className="m-0! text-xs">
                {props.document.contentSizeIsPartial ? '≥ ' : ''}
                {formatBytes(props.document.contentBytes)}
              </Tag>
            </div>
          </div>

          <Space size={10} className="shrink-0">
            <Button
              size="middle"
              icon={
                copied ? (
                  <CheckOutlined className="text-[var(--ant-color-success)]" />
                ) : (
                  <CopyOutlined />
                )
              }
              onClick={handleCopyMarkdown}
            >
              {copied ? '已复制' : '复制 Markdown'}
            </Button>
            <Button
              type="primary"
              size="middle"
              icon={<ExportOutlined />}
              href={props.document.url}
              target="_blank"
              rel="noreferrer"
            >
              打开原文
            </Button>
          </Space>
        </div>
      </header>

      {/* Markdown 阅读内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6 bg-[var(--ant-color-bg-container)]">
        <div className="prose prose-sm max-w-4xl dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.document.content}</ReactMarkdown>
        </div>
      </div>
    </Card>
  )
}
