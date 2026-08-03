export const VIEW_PATHS = {
  overview: '/',
  sources: '/sources',
  library: '/library',
  cloudCatalog: '/cloud',
  cloudLibraries: '/admin/cloud',
  settings: '/settings'
} as const

export type ViewKey = keyof typeof VIEW_PATHS

export function getActiveView(pathname: string): ViewKey {
  return (Object.entries(VIEW_PATHS).find(([, path]) => path === pathname)?.[0] ??
    'overview') as ViewKey
}
