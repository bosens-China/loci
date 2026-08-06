import {
  CloudSyncOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons'
import { Alert, Button, Card, Empty, Modal, Space, Table, Typography, message } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { CloudLibrary, CloudLibraryInput, CloudSyncJob } from '@loci/shared'
import { useCloudAdmin } from '../cloud-admin-context'
import CloudLibraryFormModal from './CloudLibraryFormModal'
import { isCloudSyncJobActive } from './cloud-sync-progress'
import { createCloudLibraryColumns } from './cloudLibraryColumns'
import { useCloudSyncJobs } from './useCloudSyncJobs'
import { queryKeys } from '../query-client'

function CloudLibrariesPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { session, loading: sessionLoading, logout } = useCloudAdmin()
  const client = useQueryClient()
  const [editingLibrary, setEditingLibrary] = useState<CloudLibrary | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [syncingIds, setSyncingIds] = useState<string[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [messageApi, contextHolder] = message.useMessage()
  const [modalApi, modalContextHolder] = Modal.useModal()

  const librariesQuery = useQuery({
    queryKey: queryKeys.cloudLibraries,
    queryFn: window.api.listCloudLibraries,
    enabled: Boolean(session)
  })
  const libraries = librariesQuery.data ?? []
  const loading = librariesQuery.isPending || librariesQuery.isFetching
  const error = librariesQuery.error
    ? errorMessage(librariesQuery.error, '云文档列表读取失败')
    : null
  const loadLibraries = useCallback(
    async () => void (await client.invalidateQueries({ queryKey: queryKeys.cloudLibraries })),
    [client]
  )

  const handleAuthError = useCallback((): void => void logout(), [logout])
  const syncState = useCloudSyncJobs({
    enabled: Boolean(session),
    onSettled: loadLibraries,
    onAuthError: handleAuthError
  })

  useEffect(() => {
    if (sessionLoading) return
    if (!session) {
      void navigate({ to: '/admin/login' })
      return
    }
    if (error?.includes('会话') || error?.includes('登录')) void logout()
  }, [error, logout, navigate, session, sessionLoading])

  const saveMutation = useMutation({
    mutationFn: ({ library, input }: { library: CloudLibrary | null; input: CloudLibraryInput }) =>
      library
        ? window.api.updateCloudLibrary(library.id, input)
        : window.api.createCloudLibrary(input),
    onSuccess: async (saved, { library }) => {
      client.setQueryData<CloudLibrary[]>(queryKeys.cloudLibraries, (current = []) =>
        library ? current.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...current]
      )
      setModalOpen(false)
      if (library) {
        messageApi.success('云文档源已更新')
        return
      }
      try {
        await syncState.submit([saved.id])
        messageApi.success('云文档源已添加，首次发布任务已提交')
      } catch (syncError) {
        messageApi.warning(
          `云文档源已添加，但首次发布未启动：${errorMessage(syncError, '同步失败')}`
        )
      }
    },
    onError: (saveError: unknown) => messageApi.error(errorMessage(saveError, '云文档源保存失败'))
  })
  const deleteMutation = useMutation({
    mutationFn: (library: CloudLibrary) => window.api.deleteCloudLibrary(library.id),
    onSuccess: (_, library) => {
      client.setQueryData<CloudLibrary[]>(queryKeys.cloudLibraries, (current = []) =>
        current.filter((item) => item.id !== library.id)
      )
      messageApi.success(`已删除 ${library.name}`)
    },
    onError: (deleteError: unknown) => messageApi.error(errorMessage(deleteError, '删除失败'))
  })

  const openCreate = (): void => {
    setEditingLibrary(null)
    setModalOpen(true)
  }

  const handleSubmit = (input: CloudLibraryInput): void => {
    saveMutation.mutate({ library: editingLibrary, input })
  }

  const handleDelete = (library: CloudLibrary): void => {
    deleteMutation.mutate(library)
  }

  const submitSync = async (ids: string[]): Promise<void> => {
    setSyncingIds(ids)
    try {
      await syncState.submit(ids)
      setSelectedIds([])
      messageApi.success(`已提交 ${ids.length} 个同步任务`)
    } catch (syncError) {
      messageApi.error(errorMessage(syncError, '同步任务提交失败'))
    } finally {
      setSyncingIds([])
    }
  }

  const confirmBatchSync = (): void => {
    const availableIds = libraries
      .filter((library) => {
        const job = syncState.jobs[library.id]
        return !job || !isCloudSyncJobActive(job)
      })
      .map((library) => library.id)
    const available = new Set(availableIds)
    const selectedAvailableIds = selectedIds.filter((id) => available.has(id))
    const ids = selectedAvailableIds.length ? selectedAvailableIds : availableIds
    modalApi.confirm({
      title: `同步 ${ids.length} 个云文档源？`,
      content: '任务将进入服务器队列，同时最多运行 3 个文档源。',
      okText: '提交同步',
      cancelText: '取消',
      onOk: () => submitSync(ids)
    })
  }

  const handleCancel = (job: CloudSyncJob): void => {
    void syncState
      .cancel(job.id)
      .then(() => messageApi.success('已提交取消请求'))
      .catch((reason: unknown) => messageApi.error(errorMessage(reason, '取消同步失败')))
  }

  const columns = createCloudLibraryColumns({
    jobs: syncState.jobs,
    syncingIds,
    onSync: (library) => void submitSync([library.id]),
    onCancel: handleCancel,
    onEdit: (library) => {
      setEditingLibrary(library)
      setModalOpen(true)
    },
    onDelete: handleDelete
  })

  if (sessionLoading || !session) return <Card loading className="h-64" />

  const published = libraries.filter((item) => item.publishedAt).length
  const attention = libraries.filter((item) => item.lastError).length
  const availableToSync = libraries.filter((library) => {
    const job = syncState.jobs[library.id]
    return !job || !isCloudSyncJobActive(job)
  }).length

  return (
    <div className="mx-auto h-full w-full max-w-[1440px] overflow-x-hidden overflow-y-auto pr-1">
      {contextHolder}
      {modalContextHolder}
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
          <Button
            icon={<CloudSyncOutlined />}
            disabled={availableToSync === 0 || syncingIds.length > 0}
            loading={syncingIds.length > 1}
            onClick={confirmBatchSync}
          >
            {selectedIds.length ? `同步所选（${selectedIds.length}）` : '同步全部'}
          </Button>
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
      {syncState.error && (
        <Alert type="error" showIcon className="mb-4" message={syncState.error} />
      )}
      <Card className="overflow-hidden" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={libraries}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys.map(String)),
            getCheckboxProps: (library) => ({
              disabled: Boolean(
                syncState.jobs[library.id] && isCloudSyncJobActive(syncState.jobs[library.id]!)
              )
            })
          }}
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
        submitting={saveMutation.isPending}
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
