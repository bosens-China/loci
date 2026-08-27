import type { UseQueryResult } from '@tanstack/react-query'
import type { TableColumnsType } from 'antd'
import { Button, Empty, Popconfirm, Progress, Space, Table, Tag, Tooltip } from 'antd'
import { CloudSyncOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { getSchedulePreset, type CloudLibrary, type CloudSyncJob } from '@loci/shared'
import { AsyncState } from '@/components/AsyncState'
import { LibraryOriginTag } from '@/components/library/LibraryOriginTag'
import { formatBytes, formatDateTime, formatDuration } from '@/utils/format'
import { useCurrentTime } from '@/hooks/use-current-time'
import { getAdminSyncPercent, isAdminJobActive } from '@/pages/admin/admin-state'
import { AdminJobActions } from '@/pages/admin/AdminJobActions'

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
      tableLayout="fixed"
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
      width: 290,
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
  libraries: CloudLibrary[] | undefined
  onControl: (id: string, action: 'pause' | 'resume' | 'stop' | 'cancel') => void
  onPriority: (id: string, priority: number) => void
  onDomainControl: (hostname: string | undefined, action: 'pause-all' | 'resume-all') => void
  pendingKey: string | undefined
}): React.JSX.Element {
  const now = useCurrentTime()
  const libraries = new Map((props.libraries ?? []).map((library) => [library.id, library]))
  const groups = groupAdminJobs(props.query.data ?? [], libraries)
  return (
    <AsyncState
      loading={props.query.isLoading}
      error={props.query.error}
      empty={props.query.data?.length === 0}
      emptyText="暂无 Server 同步任务"
      onRetry={() => void props.query.refetch()}
    >
      <div className="space-y-4">
        <div className="flex justify-end gap-2">
          <Popconfirm
            title="暂停全部 Server 活动任务？"
            okText="全部暂停"
            cancelText="返回"
            onConfirm={() => props.onDomainControl(undefined, 'pause-all')}
          >
            <Button loading={props.pendingKey === 'pause-all:*'}>全部暂停</Button>
          </Popconfirm>
          <Popconfirm
            title="恢复全部 Server 未完结任务？"
            okText="全部恢复"
            cancelText="返回"
            onConfirm={() => props.onDomainControl(undefined, 'resume-all')}
          >
            <Button loading={props.pendingKey === 'resume-all:*'}>全部恢复</Button>
          </Popconfirm>
        </div>
        {groups.map((group) => (
          <section key={group.hostname} className="panel overflow-hidden">
            <header className="border-b border-[#dce6e5] bg-[#f4f8f7] px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm font-700 text-ink">{group.hostname}</span>
                <span className="text-xs text-muted">
                  {group.jobs.length} 个任务 · {group.jobs.filter(isAdminJobActive).length} 个活动
                </span>
                <Space size={4}>
                  <Popconfirm
                    title={`暂停 ${group.hostname} 的全部活动任务？`}
                    okText="全部暂停"
                    cancelText="返回"
                    onConfirm={() => props.onDomainControl(group.hostname, 'pause-all')}
                  >
                    <Button
                      size="small"
                      type="text"
                      loading={props.pendingKey === `pause-all:${group.hostname}`}
                    >
                      全部暂停
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title={`恢复 ${group.hostname} 的全部未完结任务？`}
                    okText="全部恢复"
                    cancelText="返回"
                    onConfirm={() => props.onDomainControl(group.hostname, 'resume-all')}
                  >
                    <Button
                      size="small"
                      type="text"
                      loading={props.pendingKey === `resume-all:${group.hostname}`}
                    >
                      全部恢复
                    </Button>
                  </Popconfirm>
                </Space>
              </div>
            </header>
            <div className="max-h-96 divide-y divide-[#e5ecec] overflow-y-auto">
              {group.jobs.map((job) => {
                const library = libraries.get(job.libraryId)
                const elapsed =
                  (job.finishedAt ? new Date(job.finishedAt).getTime() : now) -
                  new Date(job.createdAt).getTime()
                return (
                  <article
                    key={job.id}
                    className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(14rem,1fr)_12rem_10rem_auto] lg:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="truncate">{library?.name ?? job.libraryId}</strong>
                        <Tag color={statusColor(job.status)}>{statusLabel(job.status)}</Tag>
                      </div>
                      <div
                        className="mt-1 truncate font-mono text-[11px] text-muted"
                        title={job.id}
                      >
                        {job.id}
                      </div>
                      {job.error && (
                        <Tooltip title={job.error} placement="bottomLeft">
                          <div className="mt-1 truncate text-xs text-[#a13d35]">
                            失败原因：{job.error}
                          </div>
                        </Tooltip>
                      )}
                    </div>
                    <JobProgress job={job} />
                    <div className="text-xs text-muted">
                      <div>耗时 {formatDuration(elapsed)}</div>
                      <div className="mt-1">正文 {formatBytes(job.contentBytes)}</div>
                      {isAdminJobActive(job) && (
                        <div className="mt-1">
                          预计剩余 {formatDuration(estimateAdminRemaining(job, elapsed))}
                        </div>
                      )}
                      {job.remainingCount > 0 && (
                        <div className="mt-1">剩余 {job.remainingCount} 页</div>
                      )}
                      <div className="mt-1">{formatDateTime(job.createdAt)}</div>
                    </div>
                    <AdminJobActions
                      job={job}
                      pendingKey={props.pendingKey}
                      onControl={props.onControl}
                      onPriority={props.onPriority}
                    />
                  </article>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </AsyncState>
  )
}

function groupAdminJobs(
  jobs: CloudSyncJob[],
  libraries: ReadonlyMap<string, CloudLibrary>
): Array<{ hostname: string; jobs: CloudSyncJob[] }> {
  const groups = new Map<string, CloudSyncJob[]>()
  for (const job of jobs) {
    const hostname = job.hostname || libraries.get(job.libraryId)?.hostname || '未知域名'
    groups.set(hostname, [...(groups.get(hostname) ?? []), job])
  }
  return [...groups.entries()]
    .map(([hostname, items]) => ({ hostname, jobs: items }))
    .sort((left, right) => left.hostname.localeCompare(right.hostname))
}

function estimateAdminRemaining(job: CloudSyncJob, elapsed: number): number | null {
  const processed = job.progress?.processed ?? 0
  if (processed <= 0 || job.remainingCount <= 0) return null
  return Math.round((elapsed / processed) * job.remainingCount)
}

function JobProgress({ job }: { job?: CloudSyncJob }): React.JSX.Element {
  if (!job) return <span className="text-xs text-muted">—</span>
  if (job.paused || job.pauseRequested) return <Tag color="warning">已暂停</Tag>
  if (job.partial) return <Tag color="warning">已结束，可继续</Tag>
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
      {job.progress.node && (
        <div className="truncate text-xs text-muted" title={job.progress.node.url}>
          {job.progress.node.status} · {job.progress.node.title}
        </div>
      )}
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
