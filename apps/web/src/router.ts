import { createRouter } from '@tanstack/react-router'
import { PageLoading } from '@/components/PageLoading'
import { routeTree } from '@/routeTree.gen'

/** Web UI 只使用 Browser History；静态资源服务负责把深链回退到 index.html。 */
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingComponent: PageLoading
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
