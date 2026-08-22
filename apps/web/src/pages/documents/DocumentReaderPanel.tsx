import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DocumentRecord } from '@loci/shared'
import { ExportOutlined } from '@ant-design/icons'
import { Button } from 'antd'

interface DocumentReaderPanelProps {
  document: DocumentRecord | null
  loading: boolean
  error: Error | null
  onRetry: () => void
}

/** 右侧阅读区：标题、外链与 Markdown 正文。 */
export function DocumentReaderPanel(props: DocumentReaderPanelProps): React.JSX.Element {
  if (props.loading) {
    return <ReaderMessage>正在加载文档…</ReaderMessage>
  }

  if (props.error) {
    return (
      <ReaderMessage>
        <div className="font-serif text-xl text-[#3a5254]">文档加载失败</div>
        <p className="mt-2 text-sm leading-6 text-muted">请检查本地服务后重试。</p>
        <Button className="mt-3" onClick={props.onRetry}>
          重试
        </Button>
      </ReaderMessage>
    )
  }

  if (!props.document) {
    return <ReaderMessage>选择一篇文档开始阅读</ReaderMessage>
  }

  return (
    <article className="workspace-pane h-full min-w-0 flex-1">
      <header className="pane-header">
        <div className="min-w-0">
          <div className="truncate text-sm font-650">{props.document.title}</div>
          <a
            className="mt-0.5 block truncate font-mono text-[11px] text-accent hover:underline"
            href={props.document.url}
            target="_blank"
            rel="noreferrer"
          >
            {props.document.url}
          </a>
        </div>
        <Button
          size="small"
          icon={<ExportOutlined />}
          href={props.document.url}
          target="_blank"
          rel="noreferrer"
        >
          打开原文
        </Button>
      </header>
      <div className="prose prose-slate min-h-0 flex-1 max-w-none overflow-y-auto px-8 py-6 text-sm leading-7">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.document.content}</ReactMarkdown>
      </div>
    </article>
  )
}

function ReaderMessage(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="workspace-pane h-full min-w-0 flex-1 items-center justify-center bg-[#fafcfc]">
      <div className="max-w-sm text-center">
        {typeof props.children === 'string' ? (
          <>
            <div className="font-serif text-xl text-[#3a5254]">{props.children}</div>
            <p className="mt-2 text-sm leading-6 text-muted">
              文档保存在本机 SQLite 索引中，搜索与阅读均离线可用。
            </p>
          </>
        ) : (
          props.children
        )}
      </div>
    </div>
  )
}
