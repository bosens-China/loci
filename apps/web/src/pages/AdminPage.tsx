import { App } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAdminSession, loginAdmin } from '@/api/admin'
import { getSettings } from '@/api/settings'
import { AsyncState } from '@/components/AsyncState'
import { AdminLoginPanel } from '@/pages/admin/AdminLoginPanel'
import { ADMIN_SESSION_KEY } from '@/pages/admin/admin-query-keys'
import { AdminWorkspace } from '@/pages/admin/AdminWorkspace'

export function AdminPage(): React.JSX.Element {
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
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <AsyncState
        loading={session.isLoading || settings.isLoading}
        error={session.error ?? settings.error}
        onRetry={() => void Promise.all([session.refetch(), settings.refetch()])}
      >
        {session.data ? (
          <AdminWorkspace session={session.data} />
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
