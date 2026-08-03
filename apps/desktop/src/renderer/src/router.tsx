import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import RootRoute from './routes/root'

const rootRoute = createRootRoute({ component: RootRoute })

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/'
}).lazy(() => import('./routes/overview.lazy').then((module) => module.Route))

const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'sources',
  validateSearch: (search: Record<string, unknown>) => ({
    tab: search.tab === 'schedules' ? ('schedules' as const) : undefined
  })
}).lazy(() => import('./routes/sources.lazy').then((module) => module.Route))

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'library',
  validateSearch: (search: Record<string, unknown>) => ({
    source: toOptionalString(search.source),
    document: toOptionalString(search.document)
  })
}).lazy(() => import('./routes/library.lazy').then((module) => module.Route))

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings'
}).lazy(() => import('./routes/settings.lazy').then((module) => module.Route))

const cloudCatalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'cloud'
}).lazy(() => import('./routes/cloud.lazy').then((module) => module.Route))

const adminLoginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'admin/login'
}).lazy(() => import('./routes/admin-login.lazy').then((module) => module.Route))

const adminCloudRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'admin/cloud'
}).lazy(() => import('./routes/admin-cloud.lazy').then((module) => module.Route))

const routeTree = rootRoute.addChildren([
  overviewRoute,
  sourcesRoute,
  libraryRoute,
  settingsRoute,
  cloudCatalogRoute,
  adminLoginRoute,
  adminCloudRoute
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}
