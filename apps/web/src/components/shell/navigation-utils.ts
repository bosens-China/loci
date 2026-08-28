export const ROUTE_TITLE_MAP: Record<string, string> = {
  '/': '概览看板',
  '/documents': '本地文档库',
  '/cloud': '云端公开库',
  '/jobs': '任务中心',
  '/logs': '操作日志',
  '/agents': 'Agent 接入',
  '/browser': '无头浏览器',
  '/settings': '系统设置',
  '/admin': 'Server 概览',
  '/admin/libraries': 'Server 文档库',
  '/admin/catalog': '公开目录预览',
  '/admin/jobs': '同步任务',
  '/admin/hostname-policies': '抓取策略',
  '/admin/audit-logs': '管理操作记录',
  '/admin/browser': '无头浏览器',
  '/login': '管理员登录'
}

/** 判断当前路由是否属于 Server 管理工作区。 */
export function isCloudRoute(pathname: string): boolean {
  return pathname.startsWith('/admin')
}

const APP_SHELL_PREFIXES = [
  '/',
  '/documents',
  '/cloud',
  '/jobs',
  '/logs',
  '/agents',
  '/browser',
  '/settings',
  '/admin',
  '/library',
  '/sources'
]

/** 判断是否为全屏独立页面（如 /login、404 未知路径等），不使用 AppShell 侧边栏与顶栏包裹。 */
export function isStandaloneRoute(pathname: string): boolean {
  if (pathname === '/login') return true
  if (pathname === '/') return false
  return !APP_SHELL_PREFIXES.some(
    (prefix) => prefix !== '/' && (pathname === prefix || pathname.startsWith(`${prefix}/`))
  )
}

/** 解析当前高亮选中的菜单 Key。 */
export function resolveActiveMenuKey(pathname: string): string {
  if (pathname in ROUTE_TITLE_MAP) {
    return pathname
  }
  // 选择最长前缀，避免 /admin 抢先匹配 /admin/libraries/publish 等子路由。
  let matched = ''
  for (const route of Object.keys(ROUTE_TITLE_MAP)) {
    if (route !== '/' && pathname.startsWith(route) && route.length > matched.length) {
      matched = route
    }
  }
  return matched || '/'
}
