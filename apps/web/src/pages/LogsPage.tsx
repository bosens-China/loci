import { useState } from 'react'
import type { OperationLog } from '@loci/shared'
import { useQuery } from '@tanstack/react-query'
import { Empty, Input, Select, Tag } from 'antd'
import { listOperationLogs, type OperationLogQuery } from '@/api/logs'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { formatDateTime } from '@/utils/format'

export function LogsPage(): React.JSX.Element {
  const [filters, setFilters] = useState<OperationLogQuery>({ limit: 100 })
  const logs = useQuery({
    queryKey: ['operation-logs', filters],
    queryFn: () => listOperationLogs(filters),
    refetchInterval: 5_000
  })
  const update = (patch: Partial<OperationLogQuery>): void =>
    setFilters((current) => ({ ...current, ...patch }))
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="操作日志"
        description="按日期查看任务、设置、云端和数据维护的结构化记录。"
      />
      <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] mb-4 grid gap-3 p-3 sm:grid-cols-4">
        <input
          aria-label="日志日期"
          type="date"
          value={filters.date ?? ''}
          onChange={(event) => update({ date: event.target.value || undefined })}
          className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ant-color-primary)] h-8 rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-3 text-sm text-[var(--ant-color-text)]"
        />
        <Select
          allowClear
          aria-label="日志分类"
          placeholder="全部分类"
          value={filters.category}
          options={categories}
          onChange={(category) => update({ category })}
        />
        <Select
          allowClear
          aria-label="日志级别"
          placeholder="全部级别"
          value={filters.level}
          options={levels}
          onChange={(level) => update({ level })}
        />
        <Input
          allowClear
          placeholder="hostname"
          value={filters.hostname}
          onChange={(event) => update({ hostname: event.target.value || undefined })}
        />
      </div>
      <AsyncState loading={logs.isLoading} error={logs.error} onRetry={() => void logs.refetch()}>
        <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] max-h-[65vh] overflow-y-auto">
          {logs.data?.items.length ? (
            <div className="divide-y divide-[var(--ant-color-border-secondary)]">
              {logs.data.items.map((item) => (
                <LogItem key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <Empty className="py-14" description="当前筛选范围没有操作记录" />
          )}
        </div>
      </AsyncState>
    </div>
  )
}

function LogItem({ item }: { item: OperationLog }): React.JSX.Element {
  return (
    <article className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_7rem_minmax(0,1fr)_10rem] sm:items-center">
      <time className="text-xs text-[var(--ant-color-text-secondary)]">
        {formatDateTime(item.createdAt)}
      </time>
      <div className="flex gap-1">
        <Tag>{categoryLabels[item.category]}</Tag>
        <Tag
          color={
            item.level === 'error' ? 'error' : item.level === 'warning' ? 'warning' : undefined
          }
        >
          {item.action}
        </Tag>
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm text-[var(--ant-color-text)]" title={item.message}>
          {item.message}
        </div>
        {item.resourceId && (
          <div className="truncate font-mono text-[11px] text-[var(--ant-color-text-secondary)]">
            {item.resourceId}
          </div>
        )}
      </div>
      <div className="truncate text-right font-mono text-xs text-[var(--ant-color-text-secondary)]">
        {item.hostname ?? '—'}
      </div>
    </article>
  )
}

const categories: Array<{ value: OperationLog['category']; label: string }> = [
  { value: 'task', label: '任务' },
  { value: 'library', label: '文档库' },
  { value: 'settings', label: '设置' },
  { value: 'cloud', label: '云端' },
  { value: 'maintenance', label: '数据维护' },
  { value: 'system', label: '系统' }
]
const levels: Array<{ value: OperationLog['level']; label: string }> = [
  { value: 'info', label: '信息' },
  { value: 'warning', label: '警告' },
  { value: 'error', label: '错误' }
]
const categoryLabels = Object.fromEntries(
  categories.map((item) => [item.value, item.label])
) as Record<OperationLog['category'], string>
