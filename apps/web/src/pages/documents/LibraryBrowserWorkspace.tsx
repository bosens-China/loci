import { useMemo, useState } from 'react'
import {
  ArrowLeftOutlined,
  CheckSquareOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  ReloadOutlined,
  SyncOutlined
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import type { DocumentRecord, LibrarySummary, UrlTreeNode } from '@loci/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Empty, Input, Select, Skeleton, Space, Tag, Tree, Typography } from 'antd'
import { deleteLibraryDocuments, getLibraryTree, readDocuments } from '@/api/documents'
import { syncLibrary } from '@/api/libraries'
import { useRawLayout } from '@/components/shell/ShellLayoutContext'
import { useLibraryDocument } from './use-library-document'
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
  category?: string
  version?: string
  versionOptions?: LibrarySummary[]
  fileId?: string
  onSelectFile: (libraryId: string, fileId: string) => void
  onForgetFile: (libraryId: string, fileId: string) => void
  onSelectVersion?: (libraryId: string) => void
  onBack: () => void
}

/** 库内目录树与阅读工作台：版本切换、多关键词实时筛选树、按需多选预览、新建文档、编辑整篇与小节管理。 */
export function LibraryBrowserWorkspace(props: LibraryBrowserWorkspaceProps): React.JSX.Element {
  useRawLayout()
  const { message } = App.useApp()
  const client = useQueryClient()

  const [keyword, setKeyword] = useState('')
  const [expansion, setExpansion] = useState<{ nodes: UrlTreeNode[]; keys: React.Key[] }>()
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [checkedKeys, setCheckedKeys] = useState<React.Key[]>([])
  const [editingDoc, setEditingDoc] = useState<DocumentRecord | 'new' | null>(null)
  const [sectionsDoc, setSectionsDoc] = useState<DocumentRecord | null>(null)

  const queries = useMemo(() => parseTreeQueries(keyword), [keyword])

  // 读取目录树（支持 queries 筛选，深层完整加载）
  const treeQuery = useQuery({
    queryKey: ['library-tree', props.libraryId, queries],
    queryFn: () => getLibraryTree(props.libraryId, { depth: DEFAULT_TREE_DEPTH, queries })
  })

  const singleDocQuery = useLibraryDocument(props.libraryId, props.fileId, props.onForgetFile)

  const treeNodes = useMemo(() => treeQuery.data ?? [], [treeQuery.data])

  // 将选中节点 key 解析为合法 read 目标（剔除 folder: 内部键，提取可读叶子 ID）
  const readTargets = useMemo(() => {
    if (!multiSelectMode) return []
    return resolveReadTargets(checkedKeys, treeNodes)
  }, [multiSelectMode, checkedKeys, treeNodes])

  const isMultiReading = multiSelectMode && readTargets.length > 0

  // 读取多选文档预览内容
  const multiDocsQuery = useQuery({
    queryKey: ['library-multi-files', props.libraryId, readTargets],
    queryFn: async () => {
      return readDocuments({
        libraryId: props.libraryId,
        targets: readTargets
      })
    },
    enabled: isMultiReading
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
    mutationFn: (targetId: string) => deleteLibraryDocuments(props.libraryId, targetId),
    onSuccess: (_, targetId) => {
      props.onForgetFile(props.libraryId, targetId)
      void client.invalidateQueries({ queryKey: ['library-tree', props.libraryId] })
      client.removeQueries({ queryKey: ['library-file', props.libraryId, targetId] })
      void message.success('文档已删除')
    },
    onError: (err: Error) => void message.error(err.message)
  })

  // 新的查询结果默认展开；用户手动折叠只应用于当前结果。
  const expandedKeys =
    expansion?.nodes === treeNodes ? expansion.keys : libraryFolderKeys(treeNodes)
  const setExpandedKeys = (keys: React.Key[]): void => setExpansion({ nodes: treeNodes, keys })

  // 将 UrlTreeNode 映射为 Ant Tree DataNode
  const treeData = useMemo(() => {
    return convertToTreeData(treeNodes, queries.length > 0)
  }, [treeNodes, queries.length])

  const exitMultiSelect = (): void => {
    setMultiSelectMode(false)
    setCheckedKeys([])
  }

  const handleSelectNode = (selected: React.Key[]): void => {
    const key = selected[0] as string | undefined
    if (!key || key.startsWith('folder:')) return
    if (multiSelectMode) {
      setCheckedKeys((prev) =>
        prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
      )
      return
    }
    props.onSelectFile(props.libraryId, key)
  }

  const versionOptions = props.versionOptions ?? []
  const hasMultipleVersions = versionOptions.length > 1

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--ant-color-bg-container)]">
      {/* 顶部工作区栏 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={props.onBack}
            className="text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)]"
          >
            返回库列表
          </Button>
          <div className="h-4 w-px bg-[var(--ant-color-border-secondary)]" />
          <div className="flex min-w-0 items-center gap-2">
            <Typography.Title level={5} className="m-0! truncate">
              {props.title}
            </Typography.Title>
            {props.category && (
              <Tag variant="filled" color="blue" className="m-0!">
                {props.category}
              </Tag>
            )}
            {hasMultipleVersions ? (
              <Select
                size="small"
                aria-label="切换文档库版本"
                value={props.libraryId}
                onChange={(nextId) => props.onSelectVersion?.(nextId)}
                options={versionOptions.map((item) => ({
                  value: item.id,
                  label: `版本 ${item.version || 'latest'}`
                }))}
                className="min-w-28"
              />
            ) : (
              props.version && (
                <Tag variant="filled" className="m-0!">
                  {props.version}
                </Tag>
              )
            )}
          </div>
        </div>

        <Space size={8}>
          <Button icon={<FileAddOutlined />} type="primary" onClick={() => setEditingDoc('new')}>
            新建文档
          </Button>
          <Button
            icon={<SyncOutlined />}
            loading={syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
          >
            重新抓取
          </Button>
          <Button
            icon={<ReloadOutlined />}
            aria-label="刷新目录与正文"
            onClick={() => {
              void treeQuery.refetch()
              if (props.fileId) void singleDocQuery.refetch()
            }}
          />
        </Space>
      </header>

      {/* 主体工作台：左侧目录树 + 右侧阅读区 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左侧目录树导航面板 */}
        <aside className="flex h-full w-80 shrink-0 flex-col overflow-hidden border-r border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]">
          {/* 搜索与展开工具 */}
          <div className="space-y-2 border-b border-[var(--ant-color-split)] p-3">
            <Input.Search
              placeholder="搜索文档，可用完整问题"
              allowClear
              loading={treeQuery.isFetching && queries.length > 0}
              onSearch={(value) => {
                setKeyword(value)
                setCheckedKeys([])
              }}
            />
            <div className="flex items-center justify-between text-xs text-[var(--ant-color-text-secondary)]">
              <span className="truncate">
                {queries.length > 0 ? `筛选: ${queries.join(' · ')}` : '目录结构'}
              </span>
              <Space size={6}>
                <Button
                  type="text"
                  size="small"
                  className="h-auto p-0! text-xs"
                  onClick={() => setExpandedKeys(libraryFolderKeys(treeNodes))}
                >
                  展开
                </Button>
                <span>/</span>
                <Button
                  type="text"
                  size="small"
                  className="h-auto p-0! text-xs"
                  onClick={() => setExpandedKeys([])}
                >
                  折叠
                </Button>
                <span>·</span>
                <Button
                  type="text"
                  size="small"
                  icon={<CheckSquareOutlined />}
                  className={`h-auto p-0! text-xs ${
                    multiSelectMode ? 'text-[var(--ant-color-primary)]!' : ''
                  }`}
                  onClick={() => (multiSelectMode ? exitMultiSelect() : setMultiSelectMode(true))}
                >
                  {multiSelectMode ? `退出多选 (${readTargets.length})` : '多选'}
                </Button>
              </Space>
            </div>
          </div>

          {/* 目录树列表：区分首次加载、加载失败、空数据与正常目录 */}
          <div className="flex-1 overflow-y-auto p-2">
            {treeQuery.isLoading ? (
              <div className="p-2">
                <Skeleton active paragraph={{ rows: 10 }} title={false} />
              </div>
            ) : treeQuery.isError ? (
              <Empty className="py-12" description={treeQuery.error?.message || '目录加载失败'}>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => void treeQuery.refetch()}
                >
                  重试
                </Button>
              </Empty>
            ) : treeData.length > 0 ? (
              <Tree
                treeData={treeData}
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys)}
                selectedKeys={!multiSelectMode && props.fileId ? [props.fileId] : []}
                onSelect={handleSelectNode}
                checkable={multiSelectMode}
                checkedKeys={readTargets}
                onCheck={(keys) => {
                  const list = Array.isArray(keys) ? keys : keys.checked
                  setCheckedKeys(resolveReadTargets(list, treeNodes))
                }}
                blockNode
                showIcon
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
        <main className="h-full min-w-0 flex-1 overflow-hidden">
          <DocumentReaderPanel
            document={!isMultiReading ? (singleDocQuery.data ?? null) : null}
            multipleDocuments={isMultiReading ? (multiDocsQuery.data ?? null) : null}
            libraryTitle={props.title}
            loading={isMultiReading ? multiDocsQuery.isLoading : singleDocQuery.isLoading}
            error={
              ((isMultiReading ? multiDocsQuery.error : singleDocQuery.error) ??
                null) as Error | null
            }
            onRetry={() => {
              if (isMultiReading) {
                void multiDocsQuery.refetch()
              } else {
                void singleDocQuery.refetch()
              }
            }}
            onExitMultiSelect={isMultiReading ? exitMultiSelect : undefined}
            onEditDoc={() => singleDocQuery.data && setEditingDoc(singleDocQuery.data)}
            onManageSections={() => singleDocQuery.data && setSectionsDoc(singleDocQuery.data)}
            onDeleteDoc={(id) => deleteDocMutation.mutateAsync(id)}
            isDeletingDoc={deleteDocMutation.isPending}
          />
        </main>
      </div>

      {/* 新建/编辑整篇文档弹窗 */}
      <DocumentEditModal
        libraryId={props.libraryId}
        editingDoc={editingDoc}
        onClose={() => setEditingDoc(null)}
        onSuccess={(saved) => props.onSelectFile(saved.sourceId, saved.id)}
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
      <div className="flex w-full items-center justify-between gap-1 pr-1">
        <span className="flex-1 truncate">{node.title || node.path || node.id}</span>
        {!isLeaf && (
          <span className="ml-1 shrink-0 text-xs text-[var(--ant-color-text-tertiary)] tabular-nums">
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
        if (isLeaf) return <FileTextOutlined className="text-[var(--ant-color-primary)]" />
        return expanded ? (
          <FolderOpenOutlined className="text-[var(--ant-color-warning)]" />
        ) : (
          <FolderOutlined className="text-[var(--ant-color-warning)]" />
        )
      },
      children: node.children ? convertToTreeData(node.children, isFiltering) : undefined
    } satisfies DataNode
  })
}
