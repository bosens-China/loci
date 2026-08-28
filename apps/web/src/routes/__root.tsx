import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router'
import { AppShell } from '@/components/AppShell'
import { NotFoundPage } from '@/pages/NotFoundPage'

import { isStandaloneRoute } from '@/components/shell/navigation-utils'

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage
})

/** /login 与 404 使用独立纯净全屏布局，不建立应用级任务或事件连接。 */
function RootLayout(): React.JSX.Element {
  const location = useLocation()

  if (isStandaloneRoute(location.pathname)) {
    return <Outlet />
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
