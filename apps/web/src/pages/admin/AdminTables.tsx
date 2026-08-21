import type { UseQueryResult } from '@tanstack/react-query'
import type { TableColumnsType } from 'antd'
import { Button, Empty, Popconfirm, Progress, Space, Table, Tag } from 'antd'
import { CloudSyncOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { getSchedulePreset, type CloudLibrary, type CloudSyncJob } from '@loci/shared'
import { AsyncState } from '@/components/AsyncState'
import { LibraryOriginTag } from '@/components/library/LibraryOriginTag'
import { formatDateTime } from '@/utils/format'
import { getAdminSyncPercent, isAdminJobActive } from '@/pages/admin/admin-state'

interface AdminLibrariesTableProps {
  libraries: CloudLibrary[] | undefined
  jobs: Record<string, CloudSyncJob>
  selected: string[]
  onSelectedChange: (ids: string[]) => void
  onEdit: (item: CloudLibrary) => void
  onDelete: (id: string) => void
  onSync: (id: string) => void
  onCancel: (id: string) => void
  onAdd: () => void
}

export function AdminLibrariesTable(props: AdminLibrariesTableProps): React.JSX.Element {
  return (
    <Table
      rowKey="id"
      dataSource={props.libraries}
      columns={libraryColumns(
        props.jobs,
        props.onEdit,
        props.onDelete,
        props.onSync,
        props.onCancel
      )}
      pagination={false}
      scroll={{ x: 1240 }}
      rowSelection={{
        selectedRowKeys: props.selected,
        onChange: (keys) => props.onSelectedChange(keys.map(String)),
        getCheckboxProps: (library) => ({
          disabled: Boolean(props.jobs[library.id] && isAdminJobActive(props.jobs[library.id]!))
        })
      }}
      locale={{
        emptyText: (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有 Server 文档库">
            <Button type="primary" icon={<PlusOutlined />} onClick={props.onAdd}>
              添加第一个文档库
            </Button>
          </Empty>
        )
      }}
    />
  )
}

function libraryColumns(
  jobs: Record<string, CloudSyncJob>,
  onEdit: (item: CloudLibrary) => void,
  onDelete: (id: string) => void,
  onSync: (id: string) => void,
  onCancel: (id: string) => void
): TableColumnsType<CloudLibrary> {
  return [
    {
      title: '文档库',
      render: (_, item) => (
        <div className="min-w-60">
          <div className="flex items-center gap-2">
            <strong>{item.name}</strong>
            <LibraryOriginTag origin="server" />
          </div>
          <div className="max-w-96 truncate font-mono text-xs text-muted">{item.url}</div>
          <div className="mt-0.5 text-xs text-muted">范围：{item.scopePath}</div>
        </div>
      )
    },
    {
      title: '页面',
      dataIndex: 'pages',
      width: 90,
      render: (pages: number) => `${pages} 页`
    },
    {
      title: '更新计划',
      dataIndex: 'schedule',
      width: 130,
      render: (value: string | null) =>
        value ? (getSchedulePreset(value)?.label ?? value) : '仅手动'
    },
    {
      title: '状态',
      width: 120,
      render: (_, item) =>
        item.lastError ? (
          <Tag color="error">需检查</Tag>
        ) : item.publishedAt ? (
          <Tag color="success">已发布</Tag>
        ) : (
          <Tag>待首次同步</Tag>
        )
    },
    { title: '同步进度', width: 190, render: (_, item) => <JobProgress job={jobs[item.id]} /> },
    {
      title: '最近同步',
      dataIndex: 'lastCrawledAt',
      width: 170,
      render: (value: string | null) => formatDateTime(value)
    },
    {
      title: '操作',
      fixed: 'right',
      width: 250,
      render: (_, item) => {
        const job = jobs[item.id]
        const running = job && isAdminJobActive(job)
        return (
          <Space>
            <Button
              type="link"
              size="small"
              icon={<CloudSyncOutlined />}
              disabled={Boolean(running)}
              onClick={() => onSync(item.id)}
            >
              同步
            </Button>
            {running && (
              <Button type="link" danger size="small" onClick={() => onCancel(job.id)}>
                取消
              </Button>
            )}
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEdit(item)}>
              编辑
            </Button>
            <Popconfirm
              title={`删除 ${item.name}？`}
              description="Server 文档及发布快照会被永久删除。"
              okButtonProps={{ danger: true }}
              onConfirm={() => onDelete(item.id)}
            >
              <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        )
      }
    }
  ]
}

export function AdminJobsTable(props: {
  query: UseQueryResult<CloudSyncJob[], Error>
  onCancel: (id: string) => void
  cancelingId: string | undefined
}): React.JSX.Element {
  return (
    <AsyncState
      loading={props.query.isLoading}
      error={props.query.error}
      empty={props.query.data?.length === 0}
      emptyText="暂无 Server 同步任务"
      onRetry={() => void props.query.refetch()}
    >
      <div className="panel overflow-hidden">
        <Table
          rowKey="id"
          dataSource={props.query.data}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: '任务',
              dataIndex: 'id',
              render: (id: string) => <span className="font-mono text-xs">{id}</span>
            },
            { title: '文档库 ID', dataIndex: 'libraryId' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (status: CloudSyncJob['status']) => (
                <Tag color={statusColor(status)}>{statusLabel(status)}</Tag>
              )
            },
            { title: '进度', width: 190, render: (_, job) => <JobProgress job={job} /> },
            { title: '创建时间', dataIndex: 'createdAt', render: formatDateTime },
            { title: '完成时间', dataIndex: 'finishedAt', render: formatDateTime },
            {
              title: '操作',
              width: 100,
              render: (_, job) =>
                isAdminJobActive(job) ? (
                  <Button
                    danger
                    type="link"
                    size="small"
                    loading={props.cancelingId === job.id}
                    onClick={() => props.onCancel(job.id)}
                  >
                    取消
                  </Button>
                ) : null
            }
          ]}
        />
      </div>
    </AsyncState>
  )
}

function JobProgress({ job }: { job?: CloudSyncJob }): React.JSX.Element {
  if (!job) return <span className="text-xs text-muted">—</span>
  if (job.status === 'failed') {
    return (
      <div className="max-w-44">
        <Tag color="error">同步失败</Tag>
        <div className="mt-1 truncate text-xs text-[#a13d35]" title={job.error ?? ''}>
          {job.error ?? '请检查 Server 日志'}
        </div>
      </div>
    )
  }
  if (job.status === 'canceled') return <Tag>已取消</Tag>
  if (job.status === 'canceling') return <Tag color="warning">正在取消</Tag>
  if (!job.progress) {
    return <Tag color={isAdminJobActive(job) ? 'processing' : undefined}>等待开始</Tag>
  }
  const { processed, queued, failed } = job.progress
  const active = isAdminJobActive(job)
  const status =
    job.status === 'completed_with_errors' ? 'exception' : active ? 'active' : 'success'
  return (
    <div className="w-40">
      <Progress percent={getAdminSyncPercent(job)} size="small" status={status} showInfo={false} />
      <div className={`text-xs ${failed ? 'text-[#a66a1f]' : 'text-muted'}`}>
        {active
          ? `已处理 ${processed} · 待处理 ${queued}`
          : failed
            ? `完成 ${processed} · 失败 ${failed}`
            : `完成 ${processed} 页`}
      </div>
    </div>
  )
}

function statusLabel(status: CloudSyncJob['status']): string {
  return (
    {
      queued: '等待中',
      running: '运行中',
      canceling: '取消中',
      canceled: '已取消',
      completed: '已完成',
      completed_with_errors: '部分失败',
      failed: '失败'
    } as const
  )[status]
}

function statusColor(status: CloudSyncJob['status']): string | undefined {
  if (['queued', 'running', 'canceling'].includes(status)) return 'processing'
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'completed_with_errors') return 'error'
  return undefined
}
