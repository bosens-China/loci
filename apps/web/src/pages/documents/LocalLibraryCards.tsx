import { useMemo, useState } from 'react'
import type { LibraryCrawlStatus, LibrarySummary } from '@loci/shared'
import {
  CheckSquareOutlined,
  DeleteOutlined,
  PlusOutlined,
  SearchOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Pagination,
  Segmented,
  Select,
  Space,
  Typography
} from 'antd'
import { listCategories } from '@/api/categories'
import { deleteLibrary, syncLibrary } from '@/api/libraries'
import { PageHeader } from '@/components/PageHeader'
import {
  countLocalLibrarySources,
  filterLocalLibrarySources,
  type LibraryKindFilter
} from '@/pages/documents/library-filter'
import { LibraryOverviewStats } from '@/pages/documents/LibraryOverviewStats'
import { LocalLibraryCardItem } from '@/pages/documents/LocalLibraryCardItem'
import {
  BatchDeleteError,
  deleteLibrarySources,
  settleLibraryActions
} from '@/pages/documents/library-batch-delete'
import { SourceFormModal } from '@/pages/documents/SourceFormModal'
import { CARD_PAGE_SIZE_OPTIONS } from '@/utils/pagination'

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

  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)))
  const start = (safePage - 1) * pageSize
  const pagedSources = filtered.slice(start, start + pageSize)
  const selectedLibraries = filtered.filter((source) => selectedIds.includes(source.id))

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
    mutationFn: (ids: string[]) => settleLibraryActions(ids, syncLibrary),
    onSuccess: ({ succeededIds, failedIds }) => {
      void client.invalidateQueries({ queryKey: ['libraries'] })
      void client.invalidateQueries({ queryKey: ['library-crawl-statuses'] })
      if (failedIds.length) {
        setSelectedIds((current) => current.filter((id) => !succeededIds.includes(id)))
        void message.warning(
          `${succeededIds.length} 个文档库已触发更新，${failedIds.length} 个更新失败`
        )
        return
      }
      void message.success(`已为选中的 ${succeededIds.length} 个文档库触发更新`)
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
        setSelectedIds((current) => current.filter((id) => !err.succeededIds.includes(id)))
        void message.warning(
          `已删除 ${err.succeededIds.length} 个文档库，${err.failedIds.length} 个删除失败`
        )
      } else {
        void message.error('批量删除失败')
      }
    }
  })

  const confirmBatchDelete = (): void => {
    if (!selectedLibraries.length) return
    const ids = selectedLibraries.map((lib) => lib.id)
    modal.confirm({
      title: `确认删除选中的 ${ids.length} 个文档库？`,
      content: (
        <>
          <p>删除后对应的全部文档与全文检索索引将从本机清除。</p>
          <ul>
            {selectedLibraries.map((lib) => (
              <li key={lib.id}>
                {lib.name} ({lib.version})
              </li>
            ))}
          </ul>
        </>
      ),
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => batchDeleteMutation.mutateAsync(ids).catch(() => undefined)
    })
  }

  const exitSelectMode = (): void => {
    setSelectMode(false)
    setSelectedIds([])
  }

  return (
    <div className="space-y-5 px-6 py-6 sm:px-8 sm:py-8">
      <PageHeader
        title="知识管理"
        description="本地离线技术文档库管理工作台，一站式抓取、检索、阅读与小节编辑。"
        action={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditingSource('new')}>
            添加文档库
          </Button>
        }
      />

      <LibraryOverviewStats
        total={counts.total}
        totalPages={totalPages}
        running={runningCrawls}
        github={counts.github}
      />

      {/* 筛选工具栏：左侧筛选条件，右侧列表操作；统一使用默认尺寸 */}
      <div className="flex items-center justify-between gap-4">
        <Space size={12} wrap>
          <Input
            prefix={<SearchOutlined className="text-[var(--ant-color-text-tertiary)]" />}
            placeholder="搜索名称、版本、URL 或 ID"
            allowClear
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value)
              setSelectedIds([])
              setPage(1)
            }}
            className="w-72"
          />
          <Select
            aria-label="按分类筛选"
            className="w-40"
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
              setSelectedIds([])
              setPage(1)
            }}
            options={[
              { label: `全部 ${counts.total}`, value: 'all' },
              { label: `文档站 ${counts.web}`, value: 'web' },
              { label: `GitHub ${counts.github}`, value: 'github' }
            ]}
          />
        </Space>

        <Button
          icon={<CheckSquareOutlined />}
          type={selectMode ? 'primary' : 'default'}
          ghost={selectMode}
          onClick={selectMode ? exitSelectMode : () => setSelectMode(true)}
          disabled={props.libraries.length === 0}
        >
          {selectMode ? '退出批量' : '批量管理'}
        </Button>
      </div>

      {/* 批量选择提示条：经典后台表格的已选信息栏 */}
      {selectMode && (
        <Alert
          type="info"
          showIcon
          title={
            <Space size={16}>
              <span>
                已选择 <Typography.Text strong>{selectedLibraries.length}</Typography.Text> 个文档库
              </span>
              <Button type="link" size="small" className="px-0!" onClick={toggleSelectAll}>
                {isAllSelected ? '取消全选' : `全选当前筛选（${filtered.length}）`}
              </Button>
            </Space>
          }
          action={
            <Space>
              <Button
                size="small"
                icon={<SyncOutlined />}
                disabled={!selectedLibraries.length || batchDeleteMutation.isPending}
                loading={batchSyncMutation.isPending}
                onClick={() => batchSyncMutation.mutate(selectedLibraries.map((lib) => lib.id))}
              >
                批量更新
              </Button>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={!selectedLibraries.length || batchSyncMutation.isPending}
                loading={batchDeleteMutation.isPending}
                onClick={confirmBatchDelete}
              >
                批量删除
              </Button>
            </Space>
          }
        />
      )}

      {/* 库列表网格 */}
      {pagedSources.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
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
        <div className="rounded-lg border border-dashed border-[var(--ant-color-border)] py-16">
          <Empty
            description={
              keyword
                ? `未找到匹配「${keyword}」的本地文档库`
                : props.libraries.length
                  ? '筛选条件下没有文档库'
                  : '当前还没有本地文档库，添加后即可抓取'
            }
          >
            {!props.libraries.length && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setEditingSource('new')}
              >
                添加第一个文档库
              </Button>
            )}
          </Empty>
        </div>
      )}

      {/* 分页器：有数据即展示总数，保持底部位置稳定 */}
      {filtered.length > 0 && (
        <div className="flex justify-end">
          <Pagination
            current={safePage}
            pageSize={pageSize}
            total={filtered.length}
            onChange={(p, ps) => {
              setPage(ps === pageSize ? p : 1)
              setPageSize(ps)
            }}
            showSizeChanger
            showTotal={(total) => `共 ${total} 个文档库`}
            pageSizeOptions={CARD_PAGE_SIZE_OPTIONS}
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
