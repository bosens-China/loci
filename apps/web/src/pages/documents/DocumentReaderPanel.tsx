import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DocumentRecord, DocumentReadResult } from '@loci/shared'
import {
  BookOutlined,
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  MenuOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { App, Button, Card, Empty, Popconfirm, Skeleton, Space, Tag, Typography } from 'antd'
import { formatDateTime } from '@/utils/format'
import { readerTitle } from './reader-markdown'

export interface DocumentReaderPanelProps {
  document: DocumentRecord | null
  multipleDocuments?: DocumentReadResult[] | null
  libraryTitle?: string
  loading: boolean
  error: Error | null
  onRetry: () => void
  onEditDoc?: () => void
  onManageSections?: () => void
  onDeleteDoc?: () => void
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
      <Card className="h-full shadow-xs">
        <Skeleton active paragraph={{ rows: 14 }} />
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
                {props.error.message || '请检查本地服务状态'}
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
      <Card
        classNames={{ body: 'p-0! h-full flex flex-col' }}
        className="h-full shadow-xs flex flex-col overflow-hidden border-[var(--ant-color-border-secondary)]"
      >
        <header className="shrink-0 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Typography.Title level={4} className="m-0!">
                已多选 {props.multipleDocuments.length} 篇文档批量预览
              </Typography.Title>
              <Typography.Text type="secondary" className="text-xs mt-1 block">
                共计约 {totalChars} 字符
              </Typography.Text>
            </div>
            <Button
              icon={copied ? <CheckOutlined /> : <CopyOutlined />}
              onClick={() => handleCopyMarkdown(combinedMarkdown)}
            >
              复制合并内容
            </Button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <article className="prose dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{combinedMarkdown}</ReactMarkdown>
          </article>
        </div>
      </Card>
    )
  }

  // 单篇文档未选中状态
  if (!props.document) {
    return (
      <Card className="h-full flex items-center justify-center shadow-xs text-center">
        <div className="max-w-md py-16 mx-auto">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--ant-color-fill-quaternary)] text-2xl text-[var(--ant-color-primary)] mb-4">
            <BookOutlined />
          </div>
          <Typography.Title level={4} className="m-0! mb-2">
            选择左侧目录节点开始阅读
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="text-xs leading-relaxed">
            支持完整目录树浏览、多关键词实时高亮筛选、多选文档预览及小节增删改。
          </Typography.Paragraph>
        </div>
      </Card>
    )
  }

  const doc = props.document

  return (
    <Card
      classNames={{ body: 'p-0! h-full flex flex-col' }}
      className="h-full shadow-xs flex flex-col overflow-hidden border-[var(--ant-color-border-secondary)]"
    >
      <header className="shrink-0 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-6 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Typography.Title level={4} className="m-0! truncate">
              {readerTitle(doc.title)}
            </Typography.Title>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--ant-color-text-secondary)]">
              <Tag className="m-0 text-[11px] font-mono">{doc.url || doc.id}</Tag>
              {doc.updatedAt && <span>更新于 {formatDateTime(doc.updatedAt)}</span>}
            </div>
          </div>

          <Space size={8}>
            <Button
              size="small"
              icon={copied ? <CheckOutlined /> : <CopyOutlined />}
              onClick={() => handleCopyMarkdown(activeContent)}
            >
              复制
            </Button>
            {props.onManageSections && (
              <Button size="small" icon={<MenuOutlined />} onClick={props.onManageSections}>
                小节管理
              </Button>
            )}
            {props.onEditDoc && (
              <Button size="small" icon={<EditOutlined />} onClick={props.onEditDoc}>
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
                onConfirm={props.onDeleteDoc}
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            )}
          </Space>
        </div>
      </header>

      {/* Markdown 正文容器 */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <article className="prose dark:prose-invert max-w-none text-sm leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {activeContent || '*文档正文为空*'}
          </ReactMarkdown>
        </article>
      </div>
    </Card>
  )
}
