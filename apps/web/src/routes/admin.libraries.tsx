import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/libraries')({
  component: AdminLibrariesLayout
})

/** Server 文档库的父路由：承载列表与从本地发布两个上下文一致的子页面。 */
function AdminLibrariesLayout(): React.JSX.Element {
  return <Outlet />
}
