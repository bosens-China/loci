import { useEffect } from 'react'
import { createFileRoute, Outlet, redirect, useRouter } from '@tanstack/react-router'
import { getAdminSession } from '@/api/admin'
import { isAdminSessionValid } from '@/pages/admin/admin-state'

export const Route = createFileRoute('/_app/admin')({
  beforeLoad: async ({ location }) => {
    const session = await getAdminSession()
    if (!isAdminSessionValid(session)) {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
        replace: true
      })
    }
    return { session }
  },
  component: AdminLayout
})

/** 云端 Server 控制台父路由 Layout：统一鉴权校验与登录守卫 */
function AdminLayout(): React.JSX.Element {
  const router = useRouter()
  const { session } = Route.useRouteContext()

  useEffect(() => {
    const delay = Date.parse(session.expiresAt) - Date.now()
    if (delay <= 0) {
      void router.invalidate()
      return
    }
    const timer = window.setTimeout(() => void router.invalidate(), delay)
    return () => window.clearTimeout(timer)
  }, [router, session.expiresAt])

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8">
      <Outlet />
    </div>
  )
}
