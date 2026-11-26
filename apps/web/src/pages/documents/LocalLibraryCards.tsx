import { useMemo, useState } from 'react'
import type { LibraryCrawlStatus, LibrarySummary } from '@loci/shared'
import {
  BookOutlined,
  CheckSquareOutlined,
  DeleteOutlined,
  FileTextOutlined,
  GithubOutlined,
  PlusOutlined,
  SearchOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Button,
  Card,
  Empty,
  Input,
  Pagination,
  Segmented,
  Select,
  Space,
  Statistic
} from 'antd'
import { listCategories } from '@/api/categories'
import { deleteLibrary, syncLibrary } from '@/api/libraries'
import { PageHeader } from '@/components/PageHeader'
import {
  countLocalLibrarySources,
  filterLocalLibrarySources,
  type LibraryKindFilter
} from '@/pages/documents/library-filter'
import { LocalLibraryCardItem } from '@/pages/documents/LocalLibraryCardItem'
import { BatchDeleteError, deleteLibrarySources } from '@/pages/documents/library-batch-delete'
import { SourceFormModal } from '@/pages/documents/SourceFormModal'
import { PAGE_SIZE_OPTIONS } from '@/utils/pagination'

export interface LocalLibraryCardsProps {
  libraries: LibrarySummary[]
  crawlStatuses: LibraryCrawlStatus[]
  onSelect: (id: string) => void
}

/** 本地文档库主工作台：概览统计指标、关键词搜索过滤、实时抓取状态、批量操作与进入目录阅读。 */
export function LocalLibraryCards(props: {
  libraries: LibrarySummary[]
  crawlStatuses: LibraryCrawlStatus[]
  onSelect: (id: string) => void
}): React.JSX.Element {
  const { message, modal } = App.useApp()
  const client = useQueryClient()

  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories })
  const [category, setCategory] = useState('')
  const [kindFilter, setKindFilter] = useState<LibraryKindFilter>('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editingSource, setEditingSource] = useState<LibrarySummary | 'new' | null>(null)

  // 抓取状态映射字典
  const crawlMap = useMemo(() => {
    const map = new Map<string, LibraryCrawlStatus>()
    for (const item of props.crawlStatuses) {
      map.set(item.libraryId, item)
    }
    return map
  }, [props.crawlStatuses])

  const counts = useMemo(() => countLocalLibrarySources(props.libraries), [props.libraries])
  const filtered = useMemo(
    () => filterLocalLibrarySources(props.libraries, { kind: kindFilter, keyword, category }),
    [kindFilter, keyword, category, props.libraries]
  )

  const totalPages = useMemo(
    () => props.libraries.reduce((sum, lib) => sum + (lib.pageCount ?? 0), 0),
    [props.libraries]
  )
  const runningCrawls = useMemo(
    () => props.crawlStatuses.filter((s) => s.status === 'running').length,
    [props.crawlStatuses]
  )

  const pagedSources = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const isAllSelected =
    filtered.length > 0 && filtered.every((item) => selectedIds.includes(item.id))

  const toggleSelectAll = (): void => {
    if (isAllSelected) {
      setSelectedIds([])
    } else {
      setSelectedIds(filtered.map((item) => item.id))
    }
  }

  // 批量更新
  const batchSyncMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.allSettled(ids.map((id) => syncLibrary(id)))
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['libraries'] })
      void client.invalidateQueries({ queryKey: ['library-crawl-statuses'] })
      void message.success(`已为选中的 ${selectedIds.length} 个文档库触发更新`)
      setSelectedIds([])
      setSelectMode(false)
    }
  })

  // 批量删除
  const batchDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteLibrarySources(ids, deleteLibrary),
    onSuccess: (deleted) => {
      void client.invalidateQueries({ queryKey: ['libraries'] })
      void client.invalidateQueries({ queryKey: ['library-crawl-statuses'] })
      void message.success(`已删除 ${deleted.length} 个文档库`)
      setSelectedIds([])
      setSelectMode(false)
    },
    onError: (err: unknown) => {
      void client.invalidateQueries({ queryKey: ['libraries'] })
      if (err instanceof BatchDeleteError) {
        setSelectedIds(err.failedIds)
        void message.warning(
          `已删除 ${err.succeededIds.length} 个文档库，${err.failedIds.length} 个删除失败`
        )
      } else {
        void message.error('批量删除失败')
      }
    }
  })

  const confirmBatchDelete = (): void => {
    modal.confirm({
      title: `确认删除选中的 ${selectedIds.length} 个文档库？`,
      content: '删除后对应的全部文档与全文检索索引将从本机清除。',
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => batchDeleteMutation.mutateAsync(selectedIds)
    })
  }

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8 space-y-5">
      <PageHeader
        title="知识管理"
        description="本地离线技术文档库管理工作台，一站式抓取、检索、阅读与小节编辑。"
        action={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditingSource('new')}>
            添加文档库
          </Button>
        }
      />

      {/* 整合概览看板指标 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card size="small" className="shadow-xs">
          <Statistic
            title="本地文档库"
            value={counts.total}
            prefix={<BookOutlined className="text-[var(--ant-color-primary)] text-sm mr-1" />}
            suffix={
              <span className="text-xs font-normal text-[var(--ant-color-text-secondary)]">个</span>
            }
          />
        </Card>
        <Card size="small" className="shadow-xs">
          <Statistic
            title="已收录总页面"
            value={totalPages}
            prefix={<FileTextOutlined className="text-[var(--ant-color-success)] text-sm mr-1" />}
            suffix={
              <span className="text-xs font-normal text-[var(--ant-color-text-secondary)]">页</span>
            }
          />
        </Card>
        <Card size="small" className="shadow-xs">
          <Statistic
            title="进行中抓取"
            value={runningCrawls}
            prefix={
              <SyncOutlined
                spin={runningCrawls > 0}
                className="text-[var(--ant-color-info)] text-sm mr-1"
              />
            }
            suffix={
              <span className="text-xs font-normal text-[var(--ant-color-text-secondary)]">个</span>
            }
          />
        </Card>
        <Card size="small" className="shadow-xs">
          <Statistic
            title="GitHub 仓库库"
            value={counts.github}
            prefix={
              <GithubOutlined className="text-[var(--ant-color-text-tertiary)] text-sm mr-1" />
            }
            suffix={
              <span className="text-xs font-normal text-[var(--ant-color-text-secondary)]">个</span>
            }
          />
        </Card>
      </div>

      {/* 搜索与工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            prefix={<SearchOutlined className="text-[var(--ant-color-text-tertiary)]" />}
            placeholder="搜索库名称、URL 或 ID..."
            allowClear
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value)
              setPage(1)
            }}
            className="w-64"
          />
          <Select
            aria-label="按分类筛选"
            className="min-w-36"
            value={category}
            options={[
              { label: '全部分类', value: '' },
              ...(categories.data ?? []).map(({ name }) => ({ label: name, value: name }))
            ]}
            onChange={(name) => {
              setCategory(name)
              setPage(1)
              setSelectedIds([])
            }}
          />
          <Segmented
            value={kindFilter}
            onChange={(val) => {
              setKindFilter(val as LibraryKindFilter)
              setPage(1)
            }}
            options={[
              { label: `全部 (${counts.total})`, value: 'all' },
              { label: `文档站 (${counts.web})`, value: 'web' },
              { label: `GitHub (${counts.github})`, value: 'github' }
            ]}
          />
        </div>

        <Space size={8}>
          {selectMode ? (
            <>
              <Button size="small" onClick={toggleSelectAll}>
                {isAllSelected ? '取消全选' : '全选'}
              </Button>
              <Button
                size="small"
                icon={<SyncOutlined />}
                disabled={selectedIds.length === 0}
                loading={batchSyncMutation.isPending}
                onClick={() => batchSyncMutation.mutate(selectedIds)}
              >
                批量更新 ({selectedIds.length})
              </Button>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={selectedIds.length === 0}
                loading={batchDeleteMutation.isPending}
                onClick={confirmBatchDelete}
              >
                批量删除 ({selectedIds.length})
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setSelectMode(false)
                  setSelectedIds([])
                }}
              >
                完成
              </Button>
            </>
          ) : (
            <Button
              size="small"
              icon={<CheckSquareOutlined />}
              onClick={() => setSelectMode(true)}
              disabled={props.libraries.length === 0}
            >
              批量管理
            </Button>
          )}
        </Space>
      </div>

      {/* 库列表网格 */}
      {pagedSources.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pagedSources.map((lib) => (
            <LocalLibraryCardItem
              key={lib.id}
              library={lib}
              crawlStatus={crawlMap.get(lib.id)}
              isSelected={selectedIds.includes(lib.id)}
              selectMode={selectMode}
              onSelectCard={() => props.onSelect(lib.id)}
              onToggleSelect={() => toggleSelect(lib.id)}
              onEdit={() => setEditingSource(lib)}
            />
          ))}
        </div>
      ) : (
        <Card className="py-12 text-center shadow-xs">
          <Empty
            description={
              keyword
                ? `未找到匹配「${keyword}」的本地文档库`
                : props.libraries.length
                  ? '筛选条件下没有文档库'
                  : '当前还没有本地文档库，点击上方按钮添加并抓取'
            }
          >
            {!props.libraries.length && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setEditingSource('new')}
              >
                立即添加第一个文档库
              </Button>
            )}
          </Empty>
        </Card>
      )}

      {/* 分页器 */}
      {filtered.length > pageSize && (
        <div className="flex justify-end pt-2">
          <Pagination
            current={page}
            pageSize={pageSize}
            total={filtered.length}
            onChange={(p, ps) => {
              setPage(p)
              setPageSize(ps)
            }}
            showSizeChanger
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            size="small"
          />
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      <SourceFormModal
        key={typeof editingSource === 'object' ? editingSource?.id : editingSource}
        categories={categories.data ?? []}
        editing={editingSource}
        onClose={() => setEditingSource(null)}
        onSaved={() => {
          setEditingSource(null)
          void client.invalidateQueries({ queryKey: ['libraries'] })
          void client.invalidateQueries({ queryKey: ['library-crawl-statuses'] })
        }}
      />
    </div>
  )
}
