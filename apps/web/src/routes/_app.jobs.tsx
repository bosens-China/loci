import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/jobs')({
  component: JobsLayout
})

/** 任务中心业务父路由 */
function JobsLayout(): React.JSX.Element {
  return <Outlet />
}
