import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { App } from 'antd'
import { getAdminSession, loginAdmin } from '@/api/admin'
import { getSettings } from '@/api/settings'
import { AsyncState } from '@/components/AsyncState'
import { AdminLoginPanel } from '@/pages/admin/AdminLoginPanel'
import { ADMIN_SESSION_KEY } from '@/pages/admin/admin-query-keys'

export const Route = createFileRoute('/admin')({
  component: AdminLayout
})

/** 云端 Server 控制台父路由 Layout：统一鉴权校验与登录守卫。 */
function AdminLayout(): React.JSX.Element {
  const client = useQueryClient()
  const { message } = App.useApp()
  const session = useQuery({ queryKey: ADMIN_SESSION_KEY, queryFn: getAdminSession })
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings })

  const login = useMutation({
    mutationFn: loginAdmin,
    onSuccess: (value) => {
      client.setQueryData(ADMIN_SESSION_KEY, value)
      void message.success('管理员已登录')
    },
    onError: (error: Error) => void message.error(error.message)
  })

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8">
      <AsyncState
        loading={session.isLoading || settings.isLoading}
        error={session.error ?? settings.error}
        onRetry={() => void Promise.all([session.refetch(), settings.refetch()])}
      >
        {session.data ? (
          <Outlet />
        ) : (
          <AdminLoginPanel
            serverUrl={settings.data?.serverUrl ?? ''}
            submitting={login.isPending}
            onSubmit={(value) => login.mutate(value)}
          />
        )}
      </AsyncState>
    </div>
  )
}
