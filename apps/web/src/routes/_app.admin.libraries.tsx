import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/admin/libraries')({
  component: AdminLibrariesLayout
})

function AdminLibrariesLayout(): React.JSX.Element {
  return <Outlet />
}
