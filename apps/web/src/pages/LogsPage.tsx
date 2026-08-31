import { useState } from 'react'
import type { OperationLog } from '@loci/shared'
import { useQuery } from '@tanstack/react-query'
import {
  Card,
  DatePicker,
  Empty,
  Input,
  Select,
  Table,
  Tag,
  Typography,
  type TableColumnsType
} from 'antd'
import dayjs from 'dayjs'
import { listOperationLogs, type OperationLogQuery } from '@/api/logs'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { formatDateTime } from '@/utils/format'
import { PAGE_SIZE_OPTIONS } from '@/utils/pagination'

/** 操作日志页：按日期与分类筛选任务、设置、云端和数据维护的结构化记录。 */
export function LogsPage(): React.JSX.Element {
  const [filters, setFilters] = useState<OperationLogQuery>({ limit: 100 })
  const logs = useQuery({
    queryKey: ['operation-logs', filters],
    queryFn: () => listOperationLogs(filters)
  })
  const update = (patch: Partial<OperationLogQuery>): void =>
    setFilters((current) => ({ ...current, ...patch }))

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8">
      <PageHeader
        title="操作日志"
        description="按日期查看任务、设置、云端和数据维护的结构化记录。"
      />
      <Card size="small" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <DatePicker
            placeholder="按日期筛选"
            value={filters.date ? dayjs(filters.date) : null}
            onChange={(_, dateStr) =>
              update({ date: typeof dateStr === 'string' ? dateStr : undefined })
            }
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
            placeholder="按域名筛选 (hostname)"
            value={filters.hostname}
            onChange={(event) => update({ hostname: event.target.value || undefined })}
          />
        </div>
      </Card>
      <AsyncState loading={logs.isLoading} error={logs.error} onRetry={() => void logs.refetch()}>
        <Card styles={{ body: { padding: 0 } }}>
          <Table<OperationLog>
            rowKey="id"
            dataSource={logs.data?.items}
            columns={columns}
            pagination={{
              defaultPageSize: 20,
              showSizeChanger: true,
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              showQuickJumper: true,
              showTotal: (total) => `共 ${total} 条日志`
            }}
            scroll={{ x: 800 }}
            locale={{
              emptyText: <Empty className="py-12" description="当前筛选范围没有操作记录" />
            }}
          />
        </Card>
      </AsyncState>
    </div>
  )
}

const columns: TableColumnsType<OperationLog> = [
  {
    title: '时间',
    dataIndex: 'createdAt',
    width: 170,
    render: (value: string) => (
      <Typography.Text type="secondary" className="text-xs">
        {formatDateTime(value)}
      </Typography.Text>
    )
  },
  {
    title: '分类',
    dataIndex: 'category',
    width: 100,
    render: (category: OperationLog['category']) => <Tag>{categoryLabels[category]}</Tag>
  },
  {
    title: '级别 / 操作',
    width: 130,
    render: (_, item) => (
      <Tag
        color={
          item.level === 'error' ? 'error' : item.level === 'warning' ? 'warning' : 'processing'
        }
      >
        {item.action}
      </Tag>
    )
  },
  {
    title: '详细信息',
    render: (_, item) => (
      <div>
        <div className="text-sm">{item.message}</div>
        {item.resourceId && (
          <Typography.Text type="secondary" className="font-mono text-xs">
            {item.resourceId}
          </Typography.Text>
        )}
      </div>
    )
  },
  {
    title: '域名',
    dataIndex: 'hostname',
    width: 150,
    render: (hostname: string | null) => (
      <Typography.Text type="secondary" className="font-mono text-xs">
        {hostname ?? '—'}
      </Typography.Text>
    )
  }
]

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
