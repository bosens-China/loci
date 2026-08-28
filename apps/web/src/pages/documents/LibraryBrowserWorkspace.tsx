import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftOutlined,
  BookOutlined,
  CloudOutlined,
  CompressOutlined,
  ExpandOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import type { DocumentRecord, UrlTreeNode } from '@loci/shared'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Empty, Input, Tag, Tooltip, Typography, Tree } from 'antd'
import { getLibraryTree, readLibraryFile, type LibraryLocation } from '@/api/library-browser'
import { AsyncState } from '@/components/AsyncState'
import { useRawLayout } from '@/components/shell/ShellLayoutContext'
import { DocumentReaderPanel } from '@/pages/documents/DocumentReaderPanel'

export function LibraryBrowserWorkspace(props: {
  location: LibraryLocation
  libraryId: string
  title: string
  onBack: () => void
}): React.JSX.Element {
  // 进入全屏 raw 布局，跳出白色内容面板约束，unmount 时自动还原
  useRawLayout()

  const [children, setChildren] = useState<Record<string, UrlTreeNode[]>>({})
  const [expandedKeys, setExpandedKeys] = useState<React.Key[] | null>(null)
  const [fileId, setFileId] = useState<string>()
  const [search, setSearch] = useState('')
  const [expanding, setExpanding] = useState(false)

  const root = useQuery({
    queryKey: ['library-tree', props.location, props.libraryId, 'root'],
    queryFn: () => getLibraryTree(props.location, props.libraryId)
  })
  const file = useQuery({
    queryKey: ['library-file', props.location, props.libraryId, fileId],
    queryFn: () => readLibraryFile(props.location, props.libraryId, fileId!),
    enabled: Boolean(fileId)
  })

  const loadFolderChildren = async (key: string): Promise<void> => {
    if (children[key]) return
    const response = await getLibraryTree(props.location, props.libraryId, key)
    setChildren((current) => ({ ...current, [key]: response.nodes }))
  }

  const defaultExpandedKeys = useMemo(
    () => (root.data?.nodes ?? []).filter((node) => !node.readable).map((node) => node.id),
    [root.data?.nodes]
  )
  const visibleExpandedKeys = expandedKeys ?? defaultExpandedKeys

  // 首次加载完成时预加载第一层目录；展开状态直接由查询结果派生，避免 effect 内同步更新状态。
  useEffect(() => {
    if (!root.data?.nodes) return
    const topFolders = root.data.nodes.filter((n) => !n.readable)
    if (topFolders.length === 0) return
    let cancelled = false
    void Promise.allSettled(
      topFolders.map(async (folder) => {
        const response = await getLibraryTree(props.location, props.libraryId, folder.id)
        return [folder.id, response.nodes] as const
      })
    ).then((results) => {
      if (cancelled) return
      const entries = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      )
      if (entries.length === 0) return
      setChildren((current) => ({ ...current, ...Object.fromEntries(entries) }))
    })
    return () => {
      cancelled = true
    }
  }, [props.libraryId, props.location, root.data?.nodes])

  // 一键展开全部目录：递归拉取所有未加载层级的子目录并全部展开
  const handleExpandAll = async (): Promise<void> => {
    setExpanding(true)
    try {
      const folderKeys = new Set<string>()
      const queue: string[] = (root.data?.nodes ?? []).filter((n) => !n.readable).map((n) => n.id)
      const nextChildren = { ...children }

      while (queue.length > 0) {
        const key = queue.shift()!
        folderKeys.add(key)
        if (!nextChildren[key]) {
          const resp = await getLibraryTree(props.location, props.libraryId, key)
          nextChildren[key] = resp.nodes
        }
        const subFolders = (nextChildren[key] ?? []).filter((n) => !n.readable).map((n) => n.id)
        for (const sub of subFolders) {
          if (!folderKeys.has(sub)) {
            queue.push(sub)
          }
        }
      }

      setChildren(nextChildren)
      setExpandedKeys(Array.from(folderKeys))
    } finally {
      setExpanding(false)
    }
  }

  // 一键收起全部目录
  const handleCollapseAll = (): void => {
    setExpandedKeys([])
  }

  const treeData = useMemo(
    () => toTreeData(root.data?.nodes ?? [], children, search),
    [children, root.data?.nodes, search]
  )
  const document = file.data ? toDocument(file.data, props.title) : null

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {/* 顶部工作区导航条 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-4 sm:px-6 shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={props.onBack}
            className="text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)]"
          >
            返回库列表
          </Button>
          <div className="h-4 w-px bg-[var(--ant-color-border-secondary)]" />
          <div className="flex items-center gap-2 min-w-0">
            <Typography.Title level={4} className="m-0! truncate text-base!">
              {props.title}
            </Typography.Title>
            <Tag
              icon={props.location === 'cloud' ? <CloudOutlined /> : <BookOutlined />}
              color={props.location === 'cloud' ? 'blue' : 'cyan'}
              className="m-0! text-xs"
            >
              {props.location === 'cloud' ? '云端公开库' : '本地离线库'}
            </Tag>
          </div>
        </div>
      </header>

      {/* 主体目录与阅读区 */}
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        {/* 左侧目录树卡片 */}
        <Card
          size="small"
          styles={{
            body: { padding: '12px', height: '100%', display: 'flex', flexDirection: 'column' }
          }}
          className="w-80 shrink-0 shadow-xs flex flex-col overflow-hidden border-[var(--ant-color-border-secondary)]"
        >
          {/* 搜索框与一键展开/收起按钮工具栏 */}
          <div className="mb-3 shrink-0 flex items-center gap-1.5">
            <Input
              allowClear
              prefix={<SearchOutlined className="text-[var(--ant-color-text-secondary)]" />}
              placeholder="搜索目录与页面..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1"
            />
            <Tooltip title="一键展开全部目录">
              <Button
                size="middle"
                icon={<ExpandOutlined />}
                loading={expanding}
                onClick={handleExpandAll}
                aria-label="一键展开全部"
                className="shrink-0 text-xs px-2 text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-primary)]"
              />
            </Tooltip>
            <Tooltip title="一键收起全部目录">
              <Button
                size="middle"
                icon={<CompressOutlined />}
                disabled={visibleExpandedKeys.length === 0}
                onClick={handleCollapseAll}
                aria-label="一键收起全部"
                className="shrink-0 text-xs px-2 text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-primary)]"
              />
            </Tooltip>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <AsyncState
              loading={root.isLoading}
              error={root.error}
              onRetry={() => void root.refetch()}
            >
              {treeData.length ? (
                <Tree
                  blockNode
                  showIcon
                  treeData={treeData}
                  selectedKeys={fileId ? [fileId] : []}
                  expandedKeys={visibleExpandedKeys}
                  onExpand={(keys) => setExpandedKeys(keys)}
                  loadData={async (node) => {
                    if (node.isLeaf) return
                    await loadFolderChildren(String(node.key))
                  }}
                  onSelect={async (_, info) => {
                    const key = String(info.node.key)
                    if (info.node.isLeaf) {
                      setFileId(key)
                    } else {
                      // 点击目录文本行或图标，自动加载子项并展开/收起目录
                      await loadFolderChildren(key)
                      setExpandedKeys((current) => {
                        const keys = current ?? defaultExpandedKeys
                        return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]
                      })
                    }
                  }}
                  className="bg-transparent!"
                />
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={search ? '没有匹配的页面' : '文档库暂无内容'}
                  className="py-12"
                />
              )}
            </AsyncState>
          </div>
        </Card>

        {/* 右侧正文阅读卡片 */}
        <div className="min-w-0 flex-1 h-full overflow-hidden">
          <DocumentReaderPanel
            document={document}
            libraryTitle={props.title}
            loading={file.isLoading}
            error={file.error}
            onRetry={() => void file.refetch()}
          />
        </div>
      </div>
    </div>
  )
}

function toTreeData(
  nodes: UrlTreeNode[],
  loaded: Record<string, UrlTreeNode[]>,
  keyword: string
): DataNode[] {
  const q = keyword.trim().toLowerCase()
  return nodes
    .filter(
      (node) => !q || node.title.toLowerCase().includes(q) || node.id.toLowerCase().includes(q)
    )
    .map((node) => ({
      key: node.id,
      title: (
        <span className="truncate block select-none text-xs" title={node.title}>
          {node.title}
        </span>
      ),
      isLeaf: node.readable,
      icon: (props: { isLeaf?: boolean; expanded?: boolean }) => {
        if (props.isLeaf) {
          return <FileTextOutlined className="text-[var(--ant-color-primary)]" />
        }
        return props.expanded ? (
          <FolderOpenOutlined className="text-[var(--ant-color-warning)]" />
        ) : (
          <FolderOutlined className="text-[var(--ant-color-warning)]" />
        )
      },
      children: node.readable
        ? undefined
        : loaded[node.id]
          ? toTreeData(loaded[node.id], loaded, keyword)
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
