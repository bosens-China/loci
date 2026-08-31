import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AppShell } from '@/components/AppShell'

export const Route = createFileRoute('/_app')({
  component: AppLayout
})

/** 无路径布局路由：为所有应用内业务页面提供统一的 AppShell 侧边栏与顶栏 */
function AppLayout(): React.JSX.Element {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
