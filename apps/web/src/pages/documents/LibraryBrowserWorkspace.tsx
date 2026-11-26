import { useMemo, useState } from 'react'
import {
  ArrowLeftOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  ReloadOutlined,
  SearchOutlined,
  SyncOutlined
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import type { DocumentRecord, UrlTreeNode } from '@loci/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Empty, Input, Space, Tag, Tree, Typography } from 'antd'
import { deleteLibraryDocuments, getLibraryTree, readDocuments } from '@/api/documents'
import { syncLibrary } from '@/api/libraries'
import { useRawLayout } from '@/components/shell/ShellLayoutContext'
import { DocumentEditModal } from './DocumentEditModal'
import { DocumentReaderPanel } from './DocumentReaderPanel'
import { DocumentSectionsModal } from './DocumentSectionsModal'
import {
  DEFAULT_TREE_DEPTH,
  libraryFolderKeys,
  parseTreeQueries,
  resolveReadTargets
} from './library-tree'

export interface LibraryBrowserWorkspaceProps {
  libraryId: string
  title: string
  fileId?: string
  onSelectFile: (fileId: string) => void
  onBack: () => void
}

/** 库内目录树与阅读工作台：单/多关键词实时筛选树、多选预览、新建文档、编辑整篇与小节管理。 */
export function LibraryBrowserWorkspace(props: {
  libraryId: string
  title: string
  fileId?: string
  onSelectFile: (fileId: string) => void
  onBack: () => void
}): React.JSX.Element {
  useRawLayout()
  const { message } = App.useApp()
  const client = useQueryClient()

  const [keyword, setKeyword] = useState('')
  const [expansion, setExpansion] = useState<{ nodes: UrlTreeNode[]; keys: React.Key[] }>()
  const [checkedKeys, setCheckedKeys] = useState<React.Key[]>([])
  const [editingDoc, setEditingDoc] = useState<DocumentRecord | 'new' | null>(null)
  const [sectionsDoc, setSectionsDoc] = useState<DocumentRecord | null>(null)

  const queries = useMemo(() => parseTreeQueries(keyword), [keyword])

  // 读取目录树（支持 queries 筛选，深层完整加载）
  const treeQuery = useQuery({
    queryKey: ['library-tree', props.libraryId, queries],
    queryFn: () => getLibraryTree(props.libraryId, { depth: DEFAULT_TREE_DEPTH, queries })
  })

  // 读取当前选中的单篇文档
  const singleDocQuery = useQuery({
    queryKey: ['library-file', props.libraryId, props.fileId],
    queryFn: async () => {
      const results = await readDocuments({
        libraryId: props.libraryId,
        targets: props.fileId!
      })
      return (results[0] as DocumentRecord) ?? null
    },
    enabled: Boolean(props.fileId)
  })

  const treeNodes = useMemo(() => treeQuery.data ?? [], [treeQuery.data])

  // 将选中节点 key 解析为合法 read 目标（剔除 folder: 内部键，提取可读叶子 ID）
  const readTargets = useMemo(() => {
    return resolveReadTargets(checkedKeys, treeNodes)
  }, [checkedKeys, treeNodes])

  // 读取多选文档预览内容
  const multiDocsQuery = useQuery({
    queryKey: ['library-multi-files', props.libraryId, readTargets],
    queryFn: async () => {
      return readDocuments({
        libraryId: props.libraryId,
        targets: readTargets
      })
    },
    enabled: readTargets.length > 1
  })

  // 快捷全量同步
  const syncMutation = useMutation({
    mutationFn: () => syncLibrary(props.libraryId),
    onSuccess: () => {
      void treeQuery.refetch()
      void message.success('已触发更新抓取')
    },
    onError: (err: Error) => void message.error(err.message)
  })

  // 删除单篇文档
  const deleteDocMutation = useMutation({
    mutationFn: async (targetId: string) => {
      return deleteLibraryDocuments(props.libraryId, targetId)
    },
    onSuccess: () => {
      void treeQuery.refetch()
      void client.invalidateQueries({ queryKey: ['library-file', props.libraryId] })
      props.onSelectFile('')
      void message.success('文档已删除')
    },
    onError: (err: Error) => void message.error(err.message)
  })

  // 新的查询结果默认展开；用户手动折叠只应用于当前结果。
  const expandedKeys =
    expansion?.nodes === treeNodes ? expansion.keys : libraryFolderKeys(treeNodes)
  const setExpandedKeys = (keys: React.Key[]) => setExpansion({ nodes: treeNodes, keys })

  // 将 UrlTreeNode 映射为 Ant Tree DataNode
  const treeData = useMemo(() => {
    return convertToTreeData(treeNodes, queries.length > 0)
  }, [treeNodes, queries.length])

  const handleSelectNode = (selected: React.Key[]): void => {
    const key = selected[0] as string | undefined
    if (key && !key.startsWith('folder:')) {
      props.onSelectFile(key)
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--ant-color-bg-layout)]">
      {/* 顶部工作区栏 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-5 shadow-xs z-10">
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
            <Typography.Title level={4} className="m-0! truncate text-base font-semibold">
              {props.title}
            </Typography.Title>
            <Tag color="blue" className="font-mono text-[11px] m-0">
              {props.libraryId}
            </Tag>
          </div>
        </div>

        <Space size={8}>
          <Button
            size="small"
            icon={<FileAddOutlined />}
            type="primary"
            onClick={() => setEditingDoc('new')}
          >
            新建文档
          </Button>
          <Button
            size="small"
            icon={<SyncOutlined />}
            loading={syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
          >
            重新抓取
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => {
              void treeQuery.refetch()
              if (props.fileId) void singleDocQuery.refetch()
            }}
          />
        </Space>
      </header>

      {/* 主体工作台：左侧目录树 + 右侧阅读区 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左侧目录树导航面板 */}
        <aside className="w-80 shrink-0 border-r border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] flex flex-col h-full overflow-hidden">
          {/* 搜索与展开工具 */}
          <div className="p-3 border-b border-[var(--ant-color-split)] space-y-2">
            <Input
              prefix={<SearchOutlined className="text-[var(--ant-color-text-tertiary)]" />}
              placeholder="单/多关键词筛选树 (空格分隔)..."
              allowClear
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              size="small"
            />
            <div className="flex items-center justify-between text-xs text-[var(--ant-color-text-secondary)]">
              <span>{queries.length > 0 ? `匹配关键词: ${queries.join(' · ')}` : '目录结构'}</span>
              <Space size={4}>
                <Button
                  type="text"
                  size="small"
                  className="p-0! h-auto text-xs"
                  onClick={() => setExpandedKeys(libraryFolderKeys(treeNodes))}
                >
                  全部展开
                </Button>
                <span>/</span>
                <Button
                  type="text"
                  size="small"
                  className="p-0! h-auto text-xs"
                  onClick={() => setExpandedKeys([])}
                >
                  全部折叠
                </Button>
              </Space>
            </div>
          </div>

          {/* 目录树列表 */}
          <div className="flex-1 overflow-y-auto p-2">
            {treeData.length > 0 ? (
              <Tree
                treeData={treeData}
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys)}
                selectedKeys={props.fileId ? [props.fileId] : []}
                onSelect={handleSelectNode}
                checkable
                checkedKeys={checkedKeys}
                onCheck={(keys) => {
                  const list = Array.isArray(keys) ? keys : keys.checked
                  setCheckedKeys(list)
                }}
                blockNode
                showIcon
                className="text-xs"
              />
            ) : (
              <Empty
                className="py-12"
                description={queries.length ? '未找到匹配关键词的文档节点' : '文档库目录为空'}
              />
            )}
          </div>
        </aside>

        {/* 右侧正文阅读与小节管理区 */}
        <main className="flex-1 min-w-0 h-full overflow-hidden p-3">
          <DocumentReaderPanel
            document={readTargets.length <= 1 ? (singleDocQuery.data ?? null) : null}
            multipleDocuments={readTargets.length > 1 ? (multiDocsQuery.data ?? null) : null}
            libraryTitle={props.title}
            loading={readTargets.length > 1 ? multiDocsQuery.isLoading : singleDocQuery.isLoading}
            error={
              ((readTargets.length > 1 ? multiDocsQuery.error : singleDocQuery.error) ??
                null) as Error | null
            }
            onRetry={() => {
              if (readTargets.length > 1) {
                void multiDocsQuery.refetch()
              } else {
                void singleDocQuery.refetch()
              }
            }}
            onEditDoc={() => singleDocQuery.data && setEditingDoc(singleDocQuery.data)}
            onManageSections={() => singleDocQuery.data && setSectionsDoc(singleDocQuery.data)}
            onDeleteDoc={() => props.fileId && deleteDocMutation.mutate(props.fileId)}
            isDeletingDoc={deleteDocMutation.isPending}
          />
        </main>
      </div>

      {/* 新建/编辑整篇文档弹窗 */}
      <DocumentEditModal
        libraryId={props.libraryId}
        editingDoc={editingDoc}
        onClose={() => setEditingDoc(null)}
        onSuccess={(saved) => {
          void treeQuery.refetch()
          props.onSelectFile(saved.id)
        }}
      />

      {/* 文档小节管理弹窗 */}
      <DocumentSectionsModal
        docId={sectionsDoc?.id ?? null}
        libraryId={props.libraryId}
        title={sectionsDoc?.title ?? ''}
        open={Boolean(sectionsDoc)}
        onClose={() => setSectionsDoc(null)}
        onDocumentUpdated={() => {
          void singleDocQuery.refetch()
        }}
      />
    </div>
  )
}

function convertToTreeData(nodes: UrlTreeNode[], isFiltering: boolean): DataNode[] {
  return nodes.map((node) => {
    const isLeaf = node.readable
    const titleNode = (
      <div className="flex items-center justify-between gap-1 w-full pr-1">
        <span className="truncate flex-1 text-xs">{node.title || node.path || node.id}</span>
        {!isLeaf && (
          <span className="text-[10px] text-[var(--ant-color-text-tertiary)] font-mono shrink-0 ml-1">
            {isFiltering && node.matchedCount !== undefined
              ? `${node.matchedCount}/${node.totalCount}`
              : node.totalCount}
          </span>
        )}
      </div>
    )

    return {
      key: node.id,
      title: titleNode,
      isLeaf,
      icon: ({ expanded }: { expanded?: boolean }) => {
        if (isLeaf) return <FileTextOutlined className="text-[var(--ant-color-primary)] text-xs" />
        return expanded ? (
          <FolderOpenOutlined className="text-amber-500 text-xs" />
        ) : (
          <FolderOutlined className="text-amber-500 text-xs" />
        )
      },
      children: node.children ? convertToTreeData(node.children, isFiltering) : undefined
    } satisfies DataNode
  })
}
