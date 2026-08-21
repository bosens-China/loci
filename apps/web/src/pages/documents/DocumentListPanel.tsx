import { useDeferredValue } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import type { DocumentRecord } from '@loci/shared'
import { listDocuments } from '@/api/documents'

interface DocumentListPanelProps {
  sourceId: string
  sourceName: string
  query: string
  selectedId: string
  onQueryChange: (query: string) => void
  onSelect: (documentId: string) => void
}

/** 中间栏：当前来源下的文档列表与搜索。 */
export function DocumentListPanel(props: DocumentListPanelProps): React.JSX.Element {
  const deferredQuery = useDeferredValue(props.query.trim())
  const documents = useQuery({
    queryKey: ['documents', deferredQuery, props.sourceId],
    queryFn: () => listDocuments(deferredQuery, props.sourceId),
    enabled: Boolean(props.sourceId)
  })

  return (
    <div className="workspace-pane h-full w-72 shrink-0 border-r xl:w-80">
      <div className="pane-header">
        <span className="pane-title truncate">{props.sourceName || '选择来源'}</span>
        <span className="font-mono text-[11px] text-muted">{documents.data?.length ?? 0}</span>
      </div>
      <div className="border-b border-[#e4eaea] px-3 py-2">
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined />}
          value={props.query}
          disabled={!props.sourceId}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder="搜索标题与正文"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!props.sourceId && <Hint>在左侧选择一个来源，查看已收录的文档</Hint>}
        {props.sourceId && documents.isLoading && <Hint>正在加载文档…</Hint>}
        {props.sourceId && documents.data?.length === 0 && (
          <Hint>{deferredQuery ? '没有匹配的文档' : '同步来源后，文档会出现在这里'}</Hint>
        )}
        {documents.data?.map((document) => (
          <DocumentRow
            key={document.id}
            document={document}
            active={document.id === props.selectedId}
            onSelect={() => props.onSelect(document.id)}
          />
        ))}
      </div>
    </div>
  )
}

function DocumentRow(props: {
  document: DocumentRecord
  active: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={`focus-ring mb-0.5 block w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
        props.active ? 'bg-[#eaf4f3] ring-1 ring-accent/20' : 'hover:bg-[#f3f7f6]'
      }`}
    >
      <div className="line-clamp-2 text-sm font-650 leading-5">{props.document.title}</div>
      <div className="mt-1 truncate text-[11px] text-muted">{props.document.language}</div>
    </button>
  )
}

function Hint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-2 py-8 text-center text-xs leading-5 text-muted">{children}</p>
}
