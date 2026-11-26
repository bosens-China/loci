export const ROUTE_TITLE_MAP: Record<string, string> = {
  '/': '知识管理',
  '/documents': '知识管理',
  '/agents': 'Agent 接入',
  '/browser': '无头浏览器',
  '/settings': '设置与数据'
}

const APP_SHELL_PREFIXES = [
  '/',
  '/documents',
  '/agents',
  '/browser',
  '/settings',
  '/library',
  '/sources'
]

/** 判断是否为全屏独立页面，404 未知路径等不使用 AppShell 侧边栏与顶栏包裹。 */
export function isStandaloneRoute(pathname: string): boolean {
  if (pathname === '/') return false
  return !APP_SHELL_PREFIXES.some(
    (prefix) => prefix !== '/' && (pathname === prefix || pathname.startsWith(`${prefix}/`))
  )
}

/** 解析当前高亮选中的菜单 Key。 */
export function resolveActiveMenuKey(pathname: string): string {
  if (
    pathname === '/' ||
    pathname.startsWith('/documents') ||
    pathname.startsWith('/library') ||
    pathname.startsWith('/sources')
  ) {
    return '/documents'
  }
  for (const route of ['/agents', '/browser', '/settings']) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return route
    }
  }
  return '/documents'
}
