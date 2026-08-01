import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import AppShell from '@renderer/components/AppShell'
import { VIEW_PATHS, getActiveView } from './navigation'

function RootRoute(): React.JSX.Element {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  return (
    <AppShell
      activeView={getActiveView(pathname)}
      onViewChange={(view) => void navigate({ to: VIEW_PATHS[view] })}
    >
      <Outlet />
    </AppShell>
  )
}

export default RootRoute
