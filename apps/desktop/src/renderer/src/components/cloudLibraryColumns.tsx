import { CloudSyncOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { Button, Popconfirm, Space, Tag, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import { getSchedulePreset, type CloudLibrary, type CloudSyncJob } from '@loci/shared'
import { CloudSyncProgress } from './CloudSyncProgress'
import { isCloudSyncJobActive } from './cloud-sync-progress'

interface CloudLibraryColumnOptions {
  jobs: Record<string, CloudSyncJob>
  syncingIds: string[]
  onSync: (library: CloudLibrary) => void
  onCancel: (job: CloudSyncJob) => void
  onEdit: (library: CloudLibrary) => void
  onDelete: (library: CloudLibrary) => void
}

export function createCloudLibraryColumns({
  jobs,
  syncingIds,
  onSync,
  onCancel,
  onEdit,
  onDelete
}: CloudLibraryColumnOptions): TableColumnsType<CloudLibrary> {
  return [
    {
      title: '文档源',
      dataIndex: 'name',
      render: (_, library) => (
        <div className="min-w-56">
          <Typography.Text strong className="block">
            {library.name}
          </Typography.Text>
          <Typography.Text type="secondary" className="block max-w-96 truncate text-xs">
            {library.url}
          </Typography.Text>
          <Typography.Text type="secondary" className="block text-xs">
            范围：{library.scopePath}
          </Typography.Text>
        </div>
      )
    },
    { title: '页面', dataIndex: 'pages', width: 90, render: (pages: number) => `${pages} 页` },
    {
      title: '更新计划',
      dataIndex: 'schedule',
      width: 130,
      render: (schedule: string | null) =>
        schedule ? (getSchedulePreset(schedule)?.label ?? schedule) : '仅手动'
    },
    {
      title: '发布状态',
      key: 'status',
      width: 120,
      render: (_, library) =>
        library.lastError ? (
          <Tag color="error">需检查</Tag>
        ) : library.publishedAt ? (
          <Tag color="success">已发布</Tag>
        ) : (
          <Tag>待首次同步</Tag>
        )
    },
    {
      title: '同步进度',
      key: 'progress',
      width: 190,
      render: (_, library) => <CloudSyncProgress job={jobs[library.id]} />
    },
    {
      title: '最近同步',
      dataIndex: 'lastCrawledAt',
      width: 170,
      render: (value: string | null) =>
        value
          ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(
              new Date(value)
            )
          : '—'
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 280,
      render: (_, library) => {
        const job = jobs[library.id]
        const active = Boolean(job && isCloudSyncJobActive(job))
        return (
          <Space size="small">
            <Button
              type="link"
              size="small"
              icon={<CloudSyncOutlined />}
              loading={syncingIds.includes(library.id)}
              disabled={active}
              onClick={() => onSync(library)}
            >
              同步
            </Button>
            {job && active && (
              <Button type="link" danger size="small" onClick={() => onCancel(job)}>
                取消
              </Button>
            )}
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEdit(library)}
            >
              编辑
            </Button>
            <Popconfirm
              title={`删除 ${library.name}？`}
              description="服务器上的文档与发布快照会被永久删除。"
              okButtonProps={{ danger: true }}
              onConfirm={() => onDelete(library)}
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
