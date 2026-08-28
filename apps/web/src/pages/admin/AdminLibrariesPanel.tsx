import { useMemo, useState } from 'react'
import type { TableColumnsType } from 'antd'
import {
  Button,
  Card,
  Col,
  Empty,
  Input,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag
} from 'antd'
import {
  CloudSyncOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { getSchedulePreset, type CloudLibrary, type CloudSyncJob } from '@loci/shared'
import { AsyncState } from '@/components/AsyncState'
import { formatDateTime } from '@/utils/format'
import { getAdminSyncPercent, isAdminJobActive } from '@/pages/admin/admin-state'

export type LibraryStatusFilter = 'all' | 'published' | 'attention' | 'pending'

interface AdminLibrariesPanelProps {
  libraries: CloudLibrary[] | undefined
  jobs: Record<string, CloudSyncJob>
  selected: string[]
  isLoading: boolean
  isFetching: boolean
  error: Error | null
  syncPending: boolean
  availableIds: string[]
  selectedAvailable: number
  onSelectedChange: (ids: string[]) => void
  onEdit: (item: CloudLibrary) => void
  onDelete: (id: string) => void
  onSync: (id: string) => void
  onBatchSync: () => void
  onCancel: (id: string) => void
  onAdd: () => void
  onRefresh: () => void
}

/** Server 文档库独立页面：标准大尺寸工具栏、指标统计看板、多维搜索过滤与表格管理。 */
export function AdminLibrariesPanel(props: AdminLibrariesPanelProps): React.JSX.Element {
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<LibraryStatusFilter>('all')

  const total = props.libraries?.length ?? 0
  const publishedCount =
    props.libraries?.filter((item) => item.publishedAt && !item.lastError).length ?? 0
  const attentionCount = props.libraries?.filter((item) => item.lastError).length ?? 0
  const pendingCount =
    props.libraries?.filter((item) => !item.publishedAt && !item.lastError).length ?? 0
  const activeCount = Object.values(props.jobs).filter(isAdminJobActive).length

  const filteredLibraries = useMemo(() => {
    const list = props.libraries ?? []
    const q = keyword.trim().toLowerCase()
    return list.filter((item) => {
      // 关键字搜索：名称、URL 或 scopePath
      if (q) {
        const match =
          item.name.toLowerCase().includes(q) ||
          item.url.toLowerCase().includes(q) ||
          item.scopePath.toLowerCase().includes(q)
        if (!match) return false
      }
      // 状态筛选
      if (statusFilter === 'published') return Boolean(item.publishedAt && !item.lastError)
      if (statusFilter === 'attention') return Boolean(item.lastError)
      if (statusFilter === 'pending') return !item.publishedAt && !item.lastError
      return true
    })
  }, [keyword, props.libraries, statusFilter])

  return (
    <div className="space-y-4">
      {/* 顶部指标看板 */}
      <Card size="small" className="shadow-xs border-[var(--ant-color-border-secondary)]">
        <Row gutter={16} className="text-center">
          <Col span={6}>
            <Statistic title="文档库总数" value={total} />
          </Col>
          <Col span={6}>
            <Statistic
              title="已发布"
              value={publishedCount}
              styles={{ content: { color: 'var(--ant-color-success)' } }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="活动任务"
              value={activeCount}
              styles={
                activeCount > 0 ? { content: { color: 'var(--ant-color-primary)' } } : undefined
              }
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="需检查"
              value={attentionCount}
              styles={
                attentionCount > 0 ? { content: { color: 'var(--ant-color-error)' } } : undefined
              }
            />
          </Col>
        </Row>
      </Card>

      {/* 标准尺寸筛选与操作工具栏 */}
      <Card size="small" className="shadow-xs border-[var(--ant-color-border-secondary)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3.5">
          {/* 左侧状态过滤分段器 */}
          <div className="overflow-x-auto">
            <Segmented<LibraryStatusFilter>
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { label: `全部 (${total})`, value: 'all' },
                { label: `已发布 (${publishedCount})`, value: 'published' },
                { label: `需检查 (${attentionCount})`, value: 'attention' },
                { label: `待同步 (${pendingCount})`, value: 'pending' }
              ]}
            />
          </div>

          {/* 右侧搜索框与主操作按钮 */}
          <div className="flex flex-wrap items-center gap-3 flex-1 md:justify-end">
            <Input
              allowClear
              prefix={<SearchOutlined className="text-[var(--ant-color-text-secondary)]" />}
              placeholder="搜索名称、URL 或路径..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-full sm:w-64"
            />
            <Space size={8} className="shrink-0">
              <Button
                icon={<CloudSyncOutlined />}
                disabled={!props.availableIds.length}
                loading={props.syncPending}
                onClick={props.onBatchSync}
              >
                {props.selected.length ? `同步所选 (${props.selectedAvailable})` : '同步全部'}
              </Button>
              <Button
                icon={<ReloadOutlined />}
                loading={props.isFetching}
                onClick={props.onRefresh}
              >
                刷新
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={props.onAdd}>
                添加文档库
              </Button>
            </Space>
          </div>
        </div>
      </Card>

      {/* 核心表格 */}
      <Card
        styles={{ body: { padding: 0 } }}
        className="shadow-xs border-[var(--ant-color-border-secondary)] overflow-hidden"
      >
        <AsyncState loading={props.isLoading} error={props.error} onRetry={props.onRefresh}>
          <Table
            rowKey="id"
            dataSource={filteredLibraries}
            columns={libraryColumns(
              props.jobs,
              props.onEdit,
              props.onDelete,
              props.onSync,
              props.onCancel
            )}
            pagination={{
              defaultPageSize: 10,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50'],
              showQuickJumper: true,
              showTotal: (t) => `共 ${t} 个文档库`
            }}
            tableLayout="fixed"
            scroll={{ x: 1100 }}
            rowSelection={{
              selectedRowKeys: props.selected,
              onChange: (keys) => props.onSelectedChange(keys.map(String)),
              getCheckboxProps: (library) => ({
                disabled: Boolean(
                  props.jobs[library.id] && isAdminJobActive(props.jobs[library.id]!)
                )
              })
            }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    keyword || statusFilter !== 'all'
                      ? '未找到匹配的 Server 文档库'
                      : '还没有 Server 文档库'
                  }
                >
                  <Button type="primary" icon={<PlusOutlined />} onClick={props.onAdd}>
                    添加第一个文档库
                  </Button>
                </Empty>
              )
            }}
          />
        </AsyncState>
      </Card>
    </div>
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
        <div className="min-w-56">
          <div className="flex items-center gap-2">
            <strong className="text-[var(--ant-color-text)]">{item.name}</strong>
            <Tag color="cyan" className="m-0! text-[10px]">
              Server
            </Tag>
          </div>
          <div className="max-w-80 truncate font-mono text-xs text-[var(--ant-color-text-secondary)] mt-0.5">
            {item.url}
          </div>
          <div className="mt-0.5 text-xs text-[var(--ant-color-text-tertiary)]">
            范围：{item.scopePath}
          </div>
        </div>
      )
    },
    { title: '页面', dataIndex: 'pages', width: 95, render: (pages: number) => `${pages} 篇` },
    {
      title: '更新计划',
      dataIndex: 'schedule',
      width: 135,
      render: (val: string | null) => (val ? (getSchedulePreset(val)?.label ?? val) : '仅手动')
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
      width: 165,
      render: (val: string | null) => formatDateTime(val)
    },
    {
      title: '操作',
      fixed: 'right',
      width: 220,
      render: (_, item) => {
        const job = jobs[item.id]
        const running = job && isAdminJobActive(job)
        return (
          <Space size={4}>
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

function JobProgress({ job }: { job?: CloudSyncJob }): React.JSX.Element {
  if (!job) return <span className="text-xs text-[var(--ant-color-text-secondary)]">—</span>
  if (job.paused || job.pauseRequested) return <Tag color="warning">已暂停</Tag>
  if (job.partial) return <Tag color="warning">已结束，可继续</Tag>
  if (job.status === 'failed') {
    return (
      <div className="max-w-44">
        <Tag color="error">同步失败</Tag>
        <div
          className="mt-1 truncate text-xs text-[var(--ant-color-error)]"
          title={job.error ?? ''}
        >
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
    <div className="w-36">
      <Progress percent={getAdminSyncPercent(job)} size="small" status={status} showInfo={false} />
      <div
        className={`text-xs ${failed ? 'text-[var(--ant-color-warning)]' : 'text-[var(--ant-color-text-secondary)]'}`}
      >
        {active
          ? `已处理 ${processed} · 待处理 ${queued}`
          : failed
            ? `完成 ${processed} · 失败 ${failed}`
            : `完成 ${processed} 页`}
      </div>
    </div>
  )
}
