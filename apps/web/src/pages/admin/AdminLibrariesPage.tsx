import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { App, Button, Space } from 'antd'
import { CloudUploadOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { CloudLibrary, CloudLibraryInput } from '@loci/shared'
import {
  createAdminLibrary,
  deleteAdminLibrary,
  listAdminJobs,
  listAdminLibraries,
  syncAdminLibraries,
  updateAdminLibrary
} from '@/api/admin'
import { PageHeader } from '@/components/PageHeader'
import { AdminLibrariesPanel } from '@/pages/admin/AdminLibrariesPanel'
import { AdminLibraryModal } from '@/pages/admin/AdminLibraryModal'
import { useAdminJobControls } from '@/pages/admin/use-admin-job-controls'
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
  latestAdminJobsByLibrary
} from '@/pages/admin/admin-state'

/** Server 文档库管理页面 */
export function AdminLibrariesPage(): React.JSX.Element {
  const client = useQueryClient()
  const navigate = useNavigate()
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
    if (previousActive.current && !active) {
      void client.invalidateQueries({ queryKey: ADMIN_LIBRARIES_KEY })
    }
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
    onSuccess: (_, variables) => {
      void client.invalidateQueries({ queryKey: ADMIN_JOBS_KEY })
      setSelected((curr) => curr.filter((id) => !variables.includes(id)))
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const runSync = async (ids: string[], successMsg: string): Promise<void> => {
    try {
      await sync.mutateAsync(ids)
      void message.success(successMsg)
    } catch (error) {
      void message.error((error as Error).message)
    }
  }

  const save = useMutation({
    mutationFn: async ({
      target,
      input
    }: {
      target: CloudLibrary | 'new'
      input: CloudLibraryInput
    }) => {
      if (target !== 'new') {
        return { library: await updateAdminLibrary(target.id, input), initialSyncError: null }
      }
      const library = await createAdminLibrary(input)
      try {
        await syncAdminLibraries([library.id])
        return { library, initialSyncError: null }
      } catch (error: unknown) {
        return {
          library,
          initialSyncError: error instanceof Error ? error : new Error('首次同步提交失败')
        }
      }
    },
    onSuccess: ({ initialSyncError }, variables) => {
      void Promise.all([
        client.invalidateQueries({ queryKey: ADMIN_LIBRARIES_KEY }),
        client.invalidateQueries({ queryKey: ADMIN_JOBS_KEY })
      ])
      setEditing(null)
      if (initialSyncError) {
        void message.warning(`文档库已创建，但首次同步未提交：${initialSyncError.message}`)
      } else {
        void message.success(
          variables.target === 'new' ? '文档库已创建，首次同步任务已提交' : '文档库已保存'
        )
      }
    },
    onError: (error: Error) => void message.error(error.message)
  })

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

  return (
    <>
      <PageHeader
        title="Server 文档库"
        description="管理远端 Loci Server 上的公开文档库、同步计划与发布状态。"
        action={
          <Space size={8}>
            <Button
              icon={<ReloadOutlined />}
              loading={libraries.isFetching || jobs.isFetching}
              onClick={() => void Promise.all([libraries.refetch(), jobs.refetch()])}
            >
              刷新
            </Button>
            <Button
              icon={<CloudUploadOutlined />}
              onClick={() => void navigate({ to: '/documents' })}
            >
              从本地发布
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
              添加文档库
            </Button>
          </Space>
        }
      />

      <AdminLibrariesPanel
        libraries={libraries.data}
        jobs={jobByLibrary}
        selected={selected}
        isLoading={libraries.isLoading}
        isFetching={libraries.isFetching || jobs.isFetching}
        error={libraries.error}
        syncPending={sync.isPending}
        availableIds={availableIds}
        selectedAvailable={selectedAvailable}
        onSelectedChange={setSelected}
        onEdit={setEditing}
        onDelete={(id) => remove.mutate(id)}
        onSync={(id) => void runSync([id], '同步任务已提交').catch(() => undefined)}
        onBatchSync={confirmBatchSync}
        onCancel={(id) => jobControls.control(id, 'cancel')}
        onAdd={() => setEditing('new')}
        onRefresh={() => void Promise.all([libraries.refetch(), jobs.refetch()])}
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
