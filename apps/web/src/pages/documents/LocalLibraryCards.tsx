import { useMemo, useState } from 'react'
import type { DocumentSource, LocalJob } from '@loci/shared'
import {
  CheckSquareOutlined,
  CloudOutlined,
  DeleteOutlined,
  GithubOutlined,
  GlobalOutlined,
  PlusOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Pagination,
  Segmented,
  Space,
  Typography
} from 'antd'
import { deleteSource } from '@/api/sources'
import { PageHeader } from '@/components/PageHeader'
import {
  countLocalLibrarySources,
  filterLocalLibrarySources,
  type LibraryKindFilter
} from '@/pages/documents/library-filter'
import { LocalLibraryCardItem } from '@/pages/documents/LocalLibraryCardItem'
import { BatchDeleteError, deleteLibrarySources } from '@/pages/documents/library-batch-delete'
import { SourceFormModal } from '@/pages/documents/SourceFormModal'
import { getLatestActiveJobsBySource } from '@/pages/jobs/job-state'
import { PAGE_SIZE_OPTIONS } from '@/utils/pagination'

/** 本地文档库卡片列表：包含类型筛选、关键字搜索、多选批量删除、弹窗编辑、分页及进入目录阅读。 */
export function LocalLibraryCards(props: {
  sources: DocumentSource[]
  jobs: LocalJob[]
  onSelect: (id: string) => void
  onPublish: (source: DocumentSource) => void
  canPublish: boolean
}): React.JSX.Element {
  const { message, modal } = App.useApp()
  const client = useQueryClient()

  const [kindFilter, setKindFilter] = useState<LibraryKindFilter>('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editingSource, setEditingSource] = useState<DocumentSource | 'new' | null>(null)
  const activeJobs = useMemo(() => getLatestActiveJobsBySource(props.jobs), [props.jobs])

  // 统计各类来源数量
  const counts = useMemo(() => countLocalLibrarySources(props.sources), [props.sources])

  // 类型与关键词组合过滤
  const filtered = useMemo(
    () => filterLocalLibrarySources(props.sources, { kind: kindFilter, keyword }),
    [kindFilter, keyword, props.sources]
  )

  const pagedSources = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  const handleKindFilterChange = (val: LibraryKindFilter): void => {
    setKindFilter(val)
    setPage(1)
  }

  const handleSearchChange = (val: string): void => {
    setKeyword(val)
    setPage(1)
  }

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const isAllSelected =
    filtered.length > 0 && filtered.every((item) => selectedIds.includes(item.id))
  const isIndeterminate =
    selectedIds.length > 0 &&
    !isAllSelected &&
    filtered.some((item) => selectedIds.includes(item.id))

  const toggleSelectAll = (): void => {
    if (isAllSelected) {
      setSelectedIds([])
    } else {
      setSelectedIds(filtered.map((item) => item.id))
    }
  }

  const singleDelete = useMutation({
    mutationFn: deleteSource,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['sources'] })
      void client.invalidateQueries({ queryKey: ['jobs'] })
      void message.success('文档源已成功删除')
    },
    onError: (err: Error) => void message.error(`删除失败: ${err.message}`)
  })

  const batchDelete = useMutation({
    mutationFn: (ids: string[]) => deleteLibrarySources(ids, deleteSource),
    onSuccess: (deletedIds) => {
      setSelectedIds([])
      setSelectMode(false)
      void message.success(`已成功批量删除 ${deletedIds.length} 个文档源`)
    },
    onError: (error: Error) => {
      if (error instanceof BatchDeleteError) {
        setSelectedIds(error.failedIds)
        void message.error(
          `已删除 ${error.succeededIds.length} 个文档源，${error.failedIds.length} 个删除失败，请重试`
        )
        return
      }
      void message.error(`批量删除失败: ${error.message}`)
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['sources'] })
      void client.invalidateQueries({ queryKey: ['jobs'] })
    }
  })

  const confirmBatchDelete = (): void => {
    const ids = [...selectedIds]
    if (!ids.length) return
    modal.confirm({
      title: `确认批量删除选中的 ${ids.length} 个文档源？`,
      content: (
        <Typography.Text type="secondary">
          删除后将一并移除已下载的离线文档与搜索索引，此操作无法撤销。
        </Typography.Text>
      ),
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => batchDelete.mutateAsync(ids)
    })
  }

  const segmentedOptions: Array<{ value: LibraryKindFilter; label: React.ReactNode }> = [
    {
      value: 'all',
      label: `全部 (${counts.total})`
    },
    {
      value: 'web',
      label: (
        <span className="flex items-center gap-1.5 px-0.5">
          <GlobalOutlined className="text-blue-500" />
          普通站点 ({counts.web})
        </span>
      )
    },
    {
      value: 'github',
      label: (
        <span className="flex items-center gap-1.5 px-0.5">
          <GithubOutlined />
          GitHub ({counts.github})
        </span>
      )
    }
  ]
  if (counts.cloud > 0) {
    segmentedOptions.push({
      value: 'cloud',
      label: (
        <span className="flex items-center gap-1.5 px-0.5">
          <CloudOutlined className="text-cyan-500" />
          云端副本 ({counts.cloud})
        </span>
      )
    })
  }

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8">
      <PageHeader
        title="本地文档库"
        description="选择目标文档库进入层级目录与离线正文阅读。"
        action={
          <Space size={8}>
            <Button
              icon={<CheckSquareOutlined />}
              type={selectMode ? 'primary' : 'default'}
              ghost={selectMode}
              onClick={() => {
                if (selectMode) setSelectedIds([])
                setSelectMode(!selectMode)
              }}
            >
              {selectMode ? '退出多选' : '批量管理'}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditingSource('new')}>
              新增文档源
            </Button>
          </Space>
        }
      />

      {/* 筛选与搜索工具栏 */}
      <Card size="small" className="mb-5 shadow-xs border-[var(--ant-color-border-secondary)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5">
          {/* 左侧类型过滤 */}
          <div className="overflow-x-auto">
            <Segmented<LibraryKindFilter>
              value={kindFilter}
              onChange={handleKindFilterChange}
              options={segmentedOptions}
            />
          </div>

          {/* 右侧搜索框与多选批量操作 */}
          <div className="flex items-center gap-3 flex-1 md:justify-end">
            <Input
              allowClear
              prefix={<SearchOutlined className="text-[var(--ant-color-text-secondary)]" />}
              placeholder="搜索文档库名称、域名或路径..."
              value={keyword}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full md:max-w-xs"
            />

            {selectMode && (
              <Space size={10} className="items-center shrink-0">
                <Checkbox
                  checked={isAllSelected}
                  indeterminate={isIndeterminate}
                  onChange={toggleSelectAll}
                >
                  全选 ({selectedIds.length}/{filtered.length})
                </Checkbox>
                <Button
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled={selectedIds.length === 0}
                  loading={batchDelete.isPending}
                  onClick={confirmBatchDelete}
                >
                  删除 ({selectedIds.length})
                </Button>
              </Space>
            )}
          </div>
        </div>
      </Card>

      {/* 卡片列表 */}
      {pagedSources.length ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pagedSources.map((source) => {
              const isSelected = selectedIds.includes(source.id)
              return (
                <LocalLibraryCardItem
                  key={source.id}
                  source={source}
                  activeJob={activeJobs.get(source.id)}
                  isSelected={isSelected}
                  selectMode={selectMode}
                  onSelectCard={() => props.onSelect(source.id)}
                  onToggleSelect={() => toggleSelect(source.id)}
                  onEdit={() => setEditingSource(source)}
                  onPublish={props.onPublish}
                  canPublish={props.canPublish}
                  onDelete={() => singleDelete.mutate(source.id)}
                  isDeleting={singleDelete.isPending}
                />
              )
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Typography.Text type="secondary" className="text-xs">
              当前展示{' '}
              <span className="font-semibold text-[var(--ant-color-text)]">{filtered.length}</span>{' '}
              个文档库
            </Typography.Text>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={filtered.length}
              showSizeChanger
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              showQuickJumper
              onChange={(p, ps) => {
                setPage(p)
                setPageSize(ps)
              }}
            />
          </div>
        </>
      ) : (
        <Card className="py-16">
          <Empty
            description={
              keyword || kindFilter !== 'all' ? '未找到匹配的文档库' : '还没有本地文档库'
            }
          />
        </Card>
      )}

      {/* 新增/编辑弹窗 */}
      <SourceFormModal
        editing={editingSource}
        onClose={() => setEditingSource(null)}
        onSaved={() => setEditingSource(null)}
      />
    </div>
  )
}
