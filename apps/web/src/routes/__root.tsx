import { createRootRoute, Outlet } from '@tanstack/react-router'
import { AppShell } from '@/components/AppShell'
import { useJobNotifications } from '@/hooks/use-job-notifications'
import { useResourceRevisions } from '@/hooks/use-resource-revisions'

export const Route = createRootRoute({ component: RootLayout })

/** 全局监听放在根路由，页面请求仍由各自路由子树负责。 */
function RootLayout(): React.JSX.Element {
  useResourceRevisions()
  useJobNotifications()
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
