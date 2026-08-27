import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CloudServerOutlined,
  CloudSyncOutlined,
  LogoutOutlined,
  PlusOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { Alert, App, Button, Popconfirm, Space, Tabs } from 'antd'
import type { CloudAdminSession, CloudLibrary, CloudLibraryInput, CloudSyncJob } from '@loci/shared'
import {
  createAdminLibrary,
  deleteAdminHostnamePolicy,
  deleteAdminLibrary,
  listAdminHostnamePolicies,
  listAdminJobs,
  listAdminLibraries,
  logoutAdmin,
  saveAdminHostnamePolicy,
  syncAdminLibraries,
  updateAdminLibrary
} from '@/api/admin'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { formatDateTime } from '@/utils/format'
import { AdminLibraryModal } from '@/pages/admin/AdminLibraryModal'
import { AdminPublishPanel } from '@/pages/admin/AdminPublishPanel'
import { AdminJobsTable, AdminLibrariesTable } from '@/pages/admin/AdminTables'
import { useAdminJobControls } from '@/pages/admin/use-admin-job-controls'
import { HostnamePolicyPanel } from '@/pages/settings/HostnamePolicyPanel'
import {
  ADMIN_JOBS_KEY,
  ADMIN_LIBRARIES_KEY,
  ADMIN_SESSION_KEY
} from '@/pages/admin/admin-query-keys'
import {
  availableAdminLibraryIds,
  getAdminLibraryRemovalWarning,
  isAdminAuthError,
  isAdminJobActive,
  latestAdminJobsByLibrary,
  mergeAdminJobs
} from '@/pages/admin/admin-state'

export function AdminWorkspace({ session }: { session: CloudAdminSession }): React.JSX.Element {
  const client = useQueryClient()
  const { message, modal } = App.useApp()
  const [editing, setEditing] = useState<CloudLibrary | 'new' | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const jobControls = useAdminJobControls()
  const previousActive = useRef(false)
  const libraries = useQuery({
    queryKey: ADMIN_LIBRARIES_KEY,
    queryFn: listAdminLibraries,
    refetchInterval: 5_000
  })
  const jobs = useQuery({
    queryKey: ADMIN_JOBS_KEY,
    queryFn: listAdminJobs,
    refetchInterval: ({ state }) => (state.data?.some(isAdminJobActive) ? 1_000 : 5_000)
  })
  const jobByLibrary = useMemo(() => latestAdminJobsByLibrary(jobs.data ?? []), [jobs.data])
  const active = (jobs.data ?? []).some(isAdminJobActive)
  const availableIds = availableAdminLibraryIds(libraries.data ?? [], jobByLibrary, selected)
  const selectedAvailable = selected.filter((id) => availableIds.includes(id)).length

  useEffect(() => {
    if (previousActive.current && !active)
      void client.invalidateQueries({ queryKey: ADMIN_LIBRARIES_KEY })
    previousActive.current = active
  }, [active, client])
  useEffect(() => {
    const error = libraries.error ?? jobs.error
    if (isAdminAuthError(error)) client.setQueryData(ADMIN_SESSION_KEY, null)
  }, [client, jobs.error, libraries.error])

  const remove = useMutation({
    mutationFn: deleteAdminLibrary,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ADMIN_LIBRARIES_KEY })
      void message.success('文档库已删除')
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const sync = useMutation({
    mutationFn: syncAdminLibraries,
    onSuccess: (incoming) => {
      client.setQueryData<CloudSyncJob[]>(ADMIN_JOBS_KEY, (current = []) =>
        mergeAdminJobs(current, incoming)
      )
      setSelected([])
    }
  })
  const save = useMutation({
    mutationFn: ({ target, input }: { target: CloudLibrary | 'new'; input: CloudLibraryInput }) =>
      target === 'new' ? createAdminLibrary(input) : updateAdminLibrary(target.id, input),
    onSuccess: async (saved, value) => {
      setEditing(null)
      await client.invalidateQueries({ queryKey: ADMIN_LIBRARIES_KEY })
      if (value.target !== 'new') {
        void message.success('Server 文档库已更新')
        return
      }
      try {
        await sync.mutateAsync([saved.id])
        void message.success('Server 文档库已添加，首次发布任务已提交')
      } catch (error) {
        void message.warning(
          `Server 文档库已添加，但首次发布未启动：${error instanceof Error ? error.message : '同步失败'}`
        )
      }
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const logout = useMutation({
    mutationFn: logoutAdmin,
    onSuccess: () => {
      client.setQueryData(ADMIN_SESSION_KEY, null)
      client.removeQueries({ queryKey: ADMIN_LIBRARIES_KEY })
      client.removeQueries({ queryKey: ADMIN_JOBS_KEY })
      void message.success('管理员已退出')
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const runSync = async (ids: string[], success: string): Promise<void> => {
    try {
      await sync.mutateAsync(ids)
      void message.success(success)
    } catch (error) {
      void message.error(error instanceof Error ? error.message : '同步任务提交失败')
      throw error
    }
  }
  const confirmBatchSync = (): void => {
    if (!availableIds.length) {
      void message.info('当前没有可提交的文档库')
      return
    }
    modal.confirm({
      title: `同步 ${availableIds.length} 个 Server 文档库？`,
      content: '任务将进入 Server 队列；活动任务不会重复提交，Server 最多并行运行 3 个文档库。',
      okText: '提交同步',
      cancelText: '取消',
      onOk: () => runSync(availableIds, `已提交 ${availableIds.length} 个同步任务`)
    })
  }
  const submitLibrary = (input: CloudLibraryInput): void => {
    const target = editing
    if (!target) return
    const removalWarning = target === 'new' ? null : getAdminLibraryRemovalWarning(target, input)
    if (removalWarning) {
      modal.confirm({
        title: '保存并立即删除不匹配的文档？',
        content: removalWarning,
        okText: '删除并保存',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => save.mutateAsync({ target, input })
      })
      return
    }
    save.mutate({ target, input })
  }
  const published = libraries.data?.filter((library) => library.publishedAt).length ?? 0
  const attention = libraries.data?.filter((library) => library.lastError).length ?? 0

  return (
    <>
      <PageHeader title="Server 管理" description="维护公开文档库、同步计划和发布任务。" />
      <div className="mb-5 flex items-center gap-4 rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] px-5 py-3">
        <CloudServerOutlined className="text-lg text-[var(--ant-color-primary)]" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs text-[var(--ant-color-text)]">
            {session.serverUrl}
          </div>
          <div className="mt-1 text-xs text-[var(--ant-color-text-secondary)]">
            {session.username} · 会话至 {formatDateTime(session.expiresAt)}
          </div>
        </div>
        <Popconfirm
          title="退出管理员账号？"
          okText="退出"
          cancelText="取消"
          onConfirm={() => logout.mutate()}
        >
          <Button icon={<LogoutOutlined />} loading={logout.isPending}>
            退出
          </Button>
        </Popconfirm>
      </div>
      <AdminSummary
        total={libraries.data?.length ?? 0}
        published={published}
        attention={attention}
        active={Object.values(jobByLibrary).filter(isAdminJobActive).length}
      />
      {jobs.error && !isAdminAuthError(jobs.error) && (
        <Alert
          type="error"
          showIcon
          className="mb-4"
          title={jobs.error.message}
          action={
            <Button size="small" onClick={() => void jobs.refetch()}>
              重试
            </Button>
          }
        />
      )}
      <Tabs
        items={[
          {
            key: 'libraries',
            label: '文档库',
            children: (
              <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] overflow-hidden">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] px-4 py-2.5">
                  <span className="text-xs font-650 tracking-wide text-[var(--ant-color-text-secondary)] uppercase">
                    Server 文档库
                  </span>
                  <Space>
                    <Button
                      icon={<CloudSyncOutlined />}
                      disabled={!availableIds.length}
                      loading={sync.isPending}
                      onClick={confirmBatchSync}
                    >
                      {selected.length ? `同步所选（${selectedAvailable}）` : '同步全部'}
                    </Button>
                    <Button
                      icon={<ReloadOutlined />}
                      loading={libraries.isFetching || jobs.isFetching}
                      onClick={() => void Promise.all([libraries.refetch(), jobs.refetch()])}
                    >
                      刷新
                    </Button>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => setEditing('new')}
                    >
                      添加文档库
                    </Button>
                  </Space>
                </div>
                <AsyncState
                  loading={libraries.isLoading}
                  error={libraries.error}
                  onRetry={() => void libraries.refetch()}
                >
                  <AdminLibrariesTable
                    libraries={libraries.data}
                    jobs={jobByLibrary}
                    selected={selected}
                    onSelectedChange={setSelected}
                    onEdit={setEditing}
                    onDelete={(id) => remove.mutate(id)}
                    onSync={(id) => void runSync([id], '同步任务已提交').catch(() => undefined)}
                    onCancel={(id) => jobControls.control(id, 'cancel')}
                    onAdd={() => setEditing('new')}
                  />
                </AsyncState>
              </div>
            )
          },
          {
            key: 'jobs',
            label: `同步任务${active ? ' · 运行中' : ''}`,
            children: (
              <AdminJobsTable
                query={jobs}
                libraries={libraries.data}
                onControl={jobControls.control}
                onPriority={jobControls.setPriority}
                onDomainControl={jobControls.controlDomain}
                pendingKey={jobControls.pendingKey}
              />
            )
          },
          {
            key: 'hostname-policies',
            label: '域名限速',
            children: (
              <HostnamePolicyPanel
                queryKey={['admin', 'hostname-policies']}
                listPolicies={listAdminHostnamePolicies}
                savePolicy={saveAdminHostnamePolicy}
                deletePolicy={deleteAdminHostnamePolicy}
                hostnames={(libraries.data ?? []).map((library) => library.hostname)}
                title="Server 域名抓取限制"
              />
            )
          },
          {
            key: 'publish',
            label: '发布本地库',
            children: <AdminPublishPanel libraries={libraries.data ?? []} />
          }
        ]}
      />
      <AdminLibraryModal
        editing={editing}
        submitting={save.isPending}
        onClose={() => setEditing(null)}
        onSubmit={submitLibrary}
      />
    </>
  )
}

function AdminSummary(props: {
  total: number
  published: number
  attention: number
  active: number
}): React.JSX.Element {
  return (
    <div className="mb-4 grid grid-cols-4 divide-x divide-[var(--ant-color-border-secondary)] rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-2 py-3">
      <SummaryItem label="文档库" value={props.total} />
      <SummaryItem label="已发布" value={props.published} />
      <SummaryItem label="活动任务" value={props.active} accent={props.active > 0} />
      <SummaryItem label="需检查" value={props.attention} warning={props.attention > 0} />
    </div>
  )
}

function SummaryItem(props: {
  label: string
  value: number
  accent?: boolean
  warning?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-center gap-2 px-4">
      <span className="text-xs text-[var(--ant-color-text-secondary)]">{props.label}</span>
      <strong
        className={
          props.warning
            ? 'text-[var(--ant-color-error)]'
            : props.accent
              ? 'text-[var(--ant-color-primary)]'
              : 'text-[var(--ant-color-text)]'
        }
      >
        {props.value}
      </strong>
    </div>
  )
}
