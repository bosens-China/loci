export type AppRoute = 'overview' | 'sources' | 'library' | 'cloud' | 'jobs' | 'settings'

const routes: Record<AppRoute, string> = {
  overview: '/',
  sources: '/sources',
  library: '/library',
  cloud: '/cloud',
  jobs: '/jobs',
  settings: '/settings'
}

export function resolveRoute(pathname: string): AppRoute {
  const found = (Object.entries(routes) as Array<[AppRoute, string]>).find(
    ([, path]) => path === pathname
  )
  return found?.[0] ?? 'overview'
}

export function routePath(route: AppRoute): string {
  return routes[route]
}
