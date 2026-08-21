export type AppRoute = 'overview' | 'documents' | 'cloud' | 'jobs' | 'settings'

const routes: Record<AppRoute, string> = {
  overview: '/',
  documents: '/documents',
  cloud: '/cloud',
  jobs: '/jobs',
  settings: '/settings'
}

/** 旧路径重定向，保证书签与外部链接仍可用。 */
const legacyRoutes: Record<string, AppRoute> = {
  '/sources': 'documents',
  '/library': 'documents'
}

export function resolveRoute(pathname: string): AppRoute {
  const legacy = legacyRoutes[pathname]
  if (legacy) return legacy
  const found = (Object.entries(routes) as Array<[AppRoute, string]>).find(
    ([, path]) => path === pathname
  )
  return found?.[0] ?? 'overview'
}

export function routePath(route: AppRoute): string {
  return routes[route]
}
