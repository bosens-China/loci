import { useMemo, useState } from 'react'
import { ArrowLeftOutlined } from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import type { DocumentRecord, UrlTreeNode } from '@loci/shared'
import { useQuery } from '@tanstack/react-query'
import { Button, Empty, Tree } from 'antd'
import { getLibraryTree, readLibraryFile, type LibraryLocation } from '@/api/library-browser'
import { AsyncState } from '@/components/AsyncState'
import { DocumentReaderPanel } from '@/pages/documents/DocumentReaderPanel'

export function LibraryBrowserWorkspace(props: {
  location: LibraryLocation
  libraryId: string
  title: string
  onBack: () => void
}): React.JSX.Element {
  const [children, setChildren] = useState<Record<string, UrlTreeNode[]>>({})
  const [fileId, setFileId] = useState<string>()
  const root = useQuery({
    queryKey: ['library-tree', props.location, props.libraryId, 'root'],
    queryFn: () => getLibraryTree(props.location, props.libraryId)
  })
  const file = useQuery({
    queryKey: ['library-file', props.location, props.libraryId, fileId],
    queryFn: () => readLibraryFile(props.location, props.libraryId, fileId!),
    enabled: Boolean(fileId)
  })
  const treeData = useMemo(
    () => toTreeData(root.data?.nodes ?? [], children),
    [children, root.data?.nodes]
  )
  const document = file.data ? toDocument(file.data, props.title) : null
  return (
    <div className="flex h-[calc(100vh-3.25rem)] min-w-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[#d8e0e0] bg-white px-4">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={props.onBack}>
          返回文档库
        </Button>
        <strong className="truncate font-serif text-lg">{props.title}</strong>
        <span className="rounded bg-[#edf6f5] px-2 py-1 text-xs text-accent">
          {props.location === 'cloud' ? '云端按需阅读' : '本地文档'}
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-80 shrink-0 overflow-y-auto border-r border-[#d8e0e0] bg-[#f7faf9] p-3">
          <AsyncState
            loading={root.isLoading}
            error={root.error}
            onRetry={() => void root.refetch()}
          >
            {treeData.length ? (
              <Tree
                blockNode
                treeData={treeData}
                selectedKeys={fileId ? [fileId] : []}
                loadData={async (node) => {
                  if (node.isLeaf || children[String(node.key)]) return
                  const response = await getLibraryTree(
                    props.location,
                    props.libraryId,
                    String(node.key)
                  )
                  setChildren((current) => ({ ...current, [String(node.key)]: response.nodes }))
                }}
                onSelect={(_, info) => {
                  if (info.node.isLeaf) setFileId(String(info.node.key))
                }}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个文档库暂无内容" />
            )}
          </AsyncState>
        </aside>
        <DocumentReaderPanel
          document={document}
          loading={file.isLoading}
          error={file.error}
          onRetry={() => void file.refetch()}
        />
      </div>
    </div>
  )
}

function toTreeData(nodes: UrlTreeNode[], loaded: Record<string, UrlTreeNode[]>): DataNode[] {
  return nodes.map((node) => ({
    key: node.id,
    title: node.title,
    isLeaf: node.readable,
    children: node.readable
      ? undefined
      : loaded[node.id]
        ? toTreeData(loaded[node.id], loaded)
        : undefined
  }))
}

function toDocument(
  file: Awaited<ReturnType<typeof readLibraryFile>>,
  sourceName: string
): DocumentRecord {
  return {
    id: file.id,
    sourceId: file.libraryId,
    sourceName,
    title: file.title,
    url: file.url,
    folder: file.path,
    language: file.language,
    updatedAt: file.updatedAt,
    content: file.content
  }
}
