import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import RootRoute from '@renderer/routes/root'

const rootRoute = createRootRoute({ component: RootRoute })

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/'
}).lazy(() => import('./routes/overview.lazy').then((module) => module.Route))

const sourcesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'sources'
}).lazy(() => import('./routes/sources.lazy').then((module) => module.Route))

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'library',
  validateSearch: (search: Record<string, unknown>) => ({
    source: toOptionalString(search.source),
    document: toOptionalString(search.document)
  })
}).lazy(() => import('./routes/library.lazy').then((module) => module.Route))

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'search',
  validateSearch: (search: Record<string, unknown>) => ({ query: toOptionalString(search.query) })
}).lazy(() => import('./routes/search.lazy').then((module) => module.Route))

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings'
}).lazy(() => import('./routes/settings.lazy').then((module) => module.Route))

const routeTree = rootRoute.addChildren([
  overviewRoute,
  sourcesRoute,
  libraryRoute,
  searchRoute,
  settingsRoute
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
