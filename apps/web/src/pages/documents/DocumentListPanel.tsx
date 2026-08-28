import { useDeferredValue, useMemo } from 'react'
import { Input, Tree } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import {
  buildUrlTree,
  type DocumentSource,
  type DocumentSummary,
  type UrlTreeNode
} from '@loci/shared'
import { LibraryOriginTag } from '@/components/library/LibraryOriginTag'

interface DocumentListPanelProps {
  sourceId: string
  source: DocumentSource | undefined
  query: string
  selectedId: string
  documents: DocumentSummary[] | undefined
  loading: boolean
  error: Error | null
  onQueryChange: (query: string) => void
  onSelect: (documentId: string) => void
  onRetry: () => void
}

/** 中间栏：当前来源下的文档列表与搜索。 */
export function DocumentListPanel(props: DocumentListPanelProps): React.JSX.Element {
  const deferredQuery = useDeferredValue(props.query.trim())
  const treeData = useMemo(
    () => toTreeData(buildUrlTree(props.documents ?? [], props.sourceId)),
    [props.documents, props.sourceId]
  )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-r border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-semibold text-[var(--ant-color-text-secondary)]">
            {props.source?.name || '选择来源'}
          </span>
          {props.source?.cloud && (
            <LibraryOriginTag origin="cloud" autoSync={props.source.cloud.autoSync} />
          )}
        </div>
        <span className="font-mono text-xs text-[var(--ant-color-text-secondary)]">
          {props.documents?.length ?? 0}
        </span>
      </div>
      <div className="border-b border-[var(--ant-color-border-secondary)] px-3 py-2">
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
        {props.sourceId && props.loading && <Hint>正在加载文档…</Hint>}
        {props.sourceId && props.error && (
          <Hint>
            文档加载失败，请
            <button
              type="button"
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ant-color-primary)] ml-1 text-[var(--ant-color-primary)] underline"
              onClick={props.onRetry}
            >
              重试
            </button>
          </Hint>
        )}
        {props.sourceId && !props.loading && !props.error && props.documents?.length === 0 && (
          <Hint>{deferredQuery ? '没有匹配的文档' : '同步来源后，文档会出现在这里'}</Hint>
        )}
        {props.sourceId && !props.loading && !props.error && treeData.length > 0 && (
          <Tree
            key={`${props.sourceId}:${deferredQuery}`}
            blockNode
            defaultExpandAll
            selectedKeys={props.selectedId ? [props.selectedId] : []}
            treeData={treeData}
            onSelect={(keys) => {
              const [documentId] = keys
              if (typeof documentId === 'string' && !documentId.startsWith('folder:')) {
                props.onSelect(documentId)
              }
            }}
          />
        )}
      </div>
    </div>
  )
}

interface DocumentTreeNode {
  key: string
  title: string
  selectable: boolean
  children?: DocumentTreeNode[]
}

function toTreeData(nodes: UrlTreeNode[]): DocumentTreeNode[] {
  return nodes.map((node) => ({
    key: node.id,
    title: node.title,
    selectable: node.readable,
    ...(node.children ? { children: toTreeData(node.children) } : {})
  }))
}

function Hint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="px-2 py-8 text-center text-xs leading-5 text-[var(--ant-color-text-secondary)]">
      {children}
    </p>
  )
}
