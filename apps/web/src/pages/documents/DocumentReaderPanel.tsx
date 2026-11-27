import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DocumentRecord, DocumentReadResult } from '@loci/shared'
import {
  BookOutlined,
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  MenuOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { App, Button, Empty, Popconfirm, Skeleton, Space, Typography } from 'antd'
import { formatDateTime } from '@/utils/format'
import {
  normalizeReaderMarkdown,
  readerTitle,
  remarkReaderHeadings,
  resolveReaderUrl
} from './reader-markdown'

export interface DocumentReaderPanelProps {
  document: DocumentRecord | null
  multipleDocuments?: DocumentReadResult[] | null
  libraryTitle?: string
  loading: boolean
  error: Error | null
  onRetry: () => void
  onExitMultiSelect?: () => void
  onEditDoc?: () => void
  onManageSections?: () => void
  onDeleteDoc?: (id: string) => Promise<unknown>
  isDeletingDoc?: boolean
}

/** 右侧阅读区：文档正文渲染、多选预览模式、以及编辑/小节管理/删除操作入口。 */
export function DocumentReaderPanel(props: DocumentReaderPanelProps): React.JSX.Element {
  const { message } = App.useApp()
  const [copied, setCopied] = useState(false)

  const activeContent = props.document?.content ?? ''

  const handleCopyMarkdown = async (text: string): Promise<void> => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      void message.success('Markdown 正文已复制')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      void message.error('复制失败，请手动复制')
    }
  }

  if (props.loading) {
    return (
      <div className="h-full bg-[var(--ant-color-bg-container)] p-8">
        <Skeleton active paragraph={{ rows: 14 }} />
      </div>
    )
  }

  if (props.error) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--ant-color-bg-container)]">
        <Empty
          description={
            <div className="space-y-1">
              <Typography.Text strong className="block">
                文档内容加载失败
              </Typography.Text>
              <Typography.Text type="secondary" className="text-xs">
                {props.error.message || '请检查本地服务状态'}
              </Typography.Text>
            </div>
          }
        >
          <Button icon={<ReloadOutlined />} type="primary" onClick={props.onRetry}>
            重新加载
          </Button>
        </Empty>
      </div>
    )
  }

  // 多文档合并预览视图
  if (props.multipleDocuments && props.multipleDocuments.length > 0) {
    const totalChars = props.multipleDocuments.reduce(
      (sum, d) => sum + (d.totalChars ?? d.content.length),
      0
    )
    const combinedMarkdown = props.multipleDocuments
      .map((d) => `# ${d.title}\n\n*路径: ${d.path}*\n\n${d.content}`)
      .join('\n\n---\n\n')

    return (
      <div className="flex h-full flex-col overflow-hidden bg-[var(--ant-color-bg-container)]">
        <header className="shrink-0 border-b border-[var(--ant-color-border-secondary)] px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Typography.Title level={5} className="m-0!">
                已多选 {props.multipleDocuments.length} 篇文档批量预览
              </Typography.Title>
              <Typography.Text type="secondary" className="mt-1 block text-xs">
                共计约 {totalChars.toLocaleString()} 字符
              </Typography.Text>
            </div>
            <Space size={8}>
              <Button
                icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                onClick={() => handleCopyMarkdown(combinedMarkdown)}
              >
                复制合并内容
              </Button>
              {props.onExitMultiSelect && (
                <Button icon={<CloseOutlined />} onClick={props.onExitMultiSelect}>
                  退出多选
                </Button>
              )}
            </Space>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {props.multipleDocuments.map((d) => (
            <article
              key={d.id}
              className="prose dark:prose-invert max-w-none text-sm leading-relaxed"
            >
              <h2>{readerTitle(d.title)}</h2>
              <p>{d.path}</p>
              {(d.nextOffset !== undefined || d.truncated) && (
                <Typography.Text type="warning">
                  预览已截断，单篇阅读可查看及复制完整正文。
                </Typography.Text>
              )}
              <ReaderMarkdown content={d.content} url={d.url} anchorPrefix={`doc-${d.id}-`} />
            </article>
          ))}
        </div>
      </div>
    )
  }

  // 单篇文档未选中状态
  if (!props.document) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--ant-color-bg-container)] text-center">
        <div className="mx-auto max-w-sm py-12">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--ant-color-fill-quaternary)] text-lg text-[var(--ant-color-primary)]">
            <BookOutlined />
          </div>
          <Typography.Title level={5} className="m-0! mb-1.5">
            选择左侧目录节点开始阅读
          </Typography.Title>
          <Typography.Text type="secondary" className="text-xs">
            支持目录树多关键词筛选、按需多选批量预览及小节增删改。
          </Typography.Text>
        </div>
      </div>
    )
  }

  const doc = props.document

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--ant-color-bg-container)]">
      <header className="shrink-0 border-b border-[var(--ant-color-border-secondary)] px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Typography.Title level={4} className="m-0! truncate">
              {readerTitle(doc.title)}
            </Typography.Title>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--ant-color-text-secondary)]">
              <span className="max-w-120 truncate font-mono">{doc.url || doc.id}</span>
              {doc.updatedAt && (
                <>
                  <span>·</span>
                  <span>更新于 {formatDateTime(doc.updatedAt)}</span>
                </>
              )}
            </div>
          </div>

          <Space size={8}>
            <Button
              icon={copied ? <CheckOutlined /> : <CopyOutlined />}
              onClick={() => handleCopyMarkdown(activeContent)}
            >
              复制
            </Button>
            {props.onManageSections && (
              <Button icon={<MenuOutlined />} onClick={props.onManageSections}>
                小节管理
              </Button>
            )}
            {props.onEditDoc && (
              <Button icon={<EditOutlined />} onClick={props.onEditDoc}>
                编辑正文
              </Button>
            )}
            {props.onDeleteDoc && (
              <Popconfirm
                title="确认删除该篇文档？"
                description="删除后将从本地库与检索索引中移除此篇文档。"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true, loading: props.isDeletingDoc }}
                onConfirm={() => props.onDeleteDoc?.(doc.id)}
              >
                <Button danger icon={<DeleteOutlined />} aria-label="删除文档" />
              </Popconfirm>
            )}
          </Space>
        </div>
      </header>

      {/* Markdown 正文容器 */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <article className="prose dark:prose-invert max-w-none text-sm leading-relaxed">
          <ReaderMarkdown content={activeContent || '*文档正文为空*'} url={doc.url} />
        </article>
      </div>
    </div>
  )
}

/** 每篇预览按各自的来源 URL 和标题锚点命名空间渲染。 */
function ReaderMarkdown(props: { content: string; url: string; anchorPrefix?: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkReaderHeadings, props.anchorPrefix]]}
      urlTransform={(value) => resolveReaderUrl(value, props.url, props.anchorPrefix)}
    >
      {normalizeReaderMarkdown(props.content)}
    </ReactMarkdown>
  )
}
