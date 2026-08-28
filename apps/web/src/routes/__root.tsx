import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router'
import { AppShell } from '@/components/AppShell'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { useJobNotifications } from '@/hooks/use-job-notifications'
import { useResourceRevisions } from '@/hooks/use-resource-revisions'

import { isStandaloneRoute } from '@/components/shell/navigation-utils'

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage
})

/** 全局监听放在根路由，页面请求仍由各自路由子树负责；/login 与 404 使用独立纯净全屏布局。 */
function RootLayout(): React.JSX.Element {
  const location = useLocation()
  useResourceRevisions()
  useJobNotifications()

  if (isStandaloneRoute(location.pathname)) {
    return <Outlet />
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
