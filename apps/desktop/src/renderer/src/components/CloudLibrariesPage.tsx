import {
  CloudSyncOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Empty,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message
} from 'antd'
import type { TableColumnsType } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { CloudLibrary, CloudLibraryInput, CloudSyncJob } from '@loci/shared'
import { getSchedulePreset } from '@loci/shared'
import { useCloudAdmin } from '../cloud-admin-context'
import CloudLibraryFormModal from './CloudLibraryFormModal'
import { CloudSyncProgress } from './CloudSyncProgress'
import { isCloudSyncJobActive } from './cloud-sync-progress'

function CloudLibrariesPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { session, loading: sessionLoading, logout } = useCloudAdmin()
  const [libraries, setLibraries] = useState<CloudLibrary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingLibrary, setEditingLibrary] = useState<CloudLibrary | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [syncJobs, setSyncJobs] = useState<Record<string, CloudSyncJob>>({})
  const [progressError, setProgressError] = useState<string | null>(null)
  const [messageApi, contextHolder] = message.useMessage()

  const loadLibraries = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      setLibraries(await window.api.listCloudLibraries())
    } catch (loadError) {
      const text = errorMessage(loadError, '云文档列表读取失败')
      setError(text)
      if (text.includes('会话') || text.includes('登录')) await logout()
    } finally {
      setLoading(false)
    }
  }, [logout, session])

  const activeJobIds = Object.values(syncJobs)
    .filter(isCloudSyncJobActive)
    .map((job) => job.id)
    .sort()
    .join(',')

  useEffect(() => {
    if (!activeJobIds) return
    const jobIds = activeJobIds.split(',')
    let mounted = true
    let requesting = false
    const poll = async (): Promise<void> => {
      if (requesting) return
      requesting = true
      try {
        const results = await Promise.allSettled(jobIds.map(window.api.getCloudSyncJob))
        if (!mounted) return
        const rejected = results.find((result) => result.status === 'rejected')
        if (rejected?.status === 'rejected') {
          const text = errorMessage(rejected.reason, '同步进度读取失败')
          setProgressError(text)
          if (text.includes('会话') || text.includes('登录')) void logout()
          return
        }
        const jobs = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : []
        )
        setProgressError(null)
        setSyncJobs((current) => ({
          ...current,
          ...Object.fromEntries(jobs.map((job) => [job.libraryId, job]))
        }))
        if (jobs.some((job) => !isCloudSyncJobActive(job))) void loadLibraries()
      } finally {
        requesting = false
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 1000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [activeJobIds, loadLibraries, logout])

  useEffect(() => {
    if (sessionLoading) return
    if (!session) {
      void navigate({ to: '/admin/login' })
      return
    }
    let active = true
    void window.api
      .listCloudLibraries()
      .then((items) => {
        if (active) setLibraries(items)
      })
      .catch((loadError: unknown) => {
        if (!active) return
        const text = errorMessage(loadError, '云文档列表读取失败')
        setError(text)
        if (text.includes('会话') || text.includes('登录')) void logout()
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [logout, navigate, session, sessionLoading])

  const openCreate = (): void => {
    setEditingLibrary(null)
    setModalOpen(true)
  }

  const handleSubmit = (input: CloudLibraryInput): void => {
    setSubmitting(true)
    const request = editingLibrary
      ? window.api.updateCloudLibrary(editingLibrary.id, input)
      : window.api.createCloudLibrary(input)
    void request
      .then((saved) => {
        setLibraries((current) =>
          editingLibrary
            ? current.map((item) => (item.id === saved.id ? saved : item))
            : [saved, ...current]
        )
        setModalOpen(false)
        messageApi.success(editingLibrary ? '云文档源已更新' : '云文档源已添加')
      })
      .catch((saveError: unknown) => messageApi.error(errorMessage(saveError, '云文档源保存失败')))
      .finally(() => setSubmitting(false))
  }

  const handleDelete = (library: CloudLibrary): void => {
    void window.api
      .deleteCloudLibrary(library.id)
      .then(() => {
        setLibraries((current) => current.filter((item) => item.id !== library.id))
        messageApi.success(`已删除 ${library.name}`)
      })
      .catch((deleteError: unknown) => messageApi.error(errorMessage(deleteError, '删除失败')))
  }

  const handleSync = (library: CloudLibrary): void => {
    setSyncingId(library.id)
    void window.api
      .syncCloudLibrary(library.id)
      .then((job) => {
        setSyncJobs((current) => ({ ...current, [library.id]: job }))
        messageApi.success(`${library.name} 的同步任务已提交`)
      })
      .catch((syncError: unknown) => messageApi.error(errorMessage(syncError, '同步任务提交失败')))
      .finally(() => setSyncingId(null))
  }

  const columns: TableColumnsType<CloudLibrary> = [
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
      render: (_, library) => <CloudSyncProgress job={syncJobs[library.id]} />
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
      width: 220,
      render: (_, library) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<CloudSyncOutlined />}
            loading={
              syncingId === library.id || Boolean(syncJobs[library.id]?.status === 'running')
            }
            disabled={syncJobs[library.id]?.status === 'queued'}
            onClick={() => handleSync(library)}
          >
            同步
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingLibrary(library)
              setModalOpen(true)
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title={`删除 ${library.name}？`}
            description="服务器上的文档与发布快照会被永久删除。"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(library)}
          >
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  if (sessionLoading || !session) return <Card loading className="h-64" />

  const published = libraries.filter((item) => item.publishedAt).length
  const attention = libraries.filter((item) => item.lastError).length

  return (
    <div className="mx-auto h-full w-full max-w-[1440px] overflow-x-hidden overflow-y-auto pr-1">
      {contextHolder}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <SafetyCertificateOutlined className="text-[var(--ant-color-primary)]" />
            <Typography.Text type="secondary">{session.serverUrl}</Typography.Text>
          </div>
          <Typography.Title level={2} className="mb-1!">
            云文档管理
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="mb-0!">
            维护服务器公开文档源、抓取时间与发布状态。
          </Typography.Paragraph>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadLibraries()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            添加云文档源
          </Button>
        </Space>
      </div>

      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-5 py-3 text-sm">
        <span>
          <Typography.Text type="secondary">文档源 </Typography.Text>
          <Typography.Text strong>{libraries.length}</Typography.Text>
        </span>
        <span>
          <Typography.Text type="secondary">已发布 </Typography.Text>
          <Typography.Text strong>{published}</Typography.Text>
        </span>
        <span>
          <Typography.Text type="secondary">需检查 </Typography.Text>
          <Typography.Text strong type={attention ? 'danger' : undefined}>
            {attention}
          </Typography.Text>
        </span>
        <span className="ml-auto">
          <Typography.Text type="secondary">管理员 </Typography.Text>
          <Typography.Text>{session.username}</Typography.Text>
        </span>
      </div>

      {error && (
        <Alert
          type="error"
          showIcon
          className="mb-4"
          message={error}
          action={
            <Button size="small" onClick={() => void loadLibraries()}>
              重试
            </Button>
          }
        />
      )}
      {progressError && <Alert type="error" showIcon className="mb-4" message={progressError} />}
      <Card className="overflow-hidden" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={libraries}
          pagination={false}
          scroll={{ x: 1240 }}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有云文档源">
                <Button type="primary" onClick={openCreate}>
                  添加第一个文档源
                </Button>
              </Empty>
            )
          }}
        />
      </Card>
      <CloudLibraryFormModal
        open={modalOpen}
        library={editingLibrary}
        submitting={submitting}
        onCancel={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export default CloudLibrariesPage
