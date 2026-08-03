const allowedProtocols = new Set(['http:', 'https:'])

/** 统一收录路径，根路径始终表示整个站点。 */
export function normalizeScopePath(input: string): string {
  const value = input.trim() || '/'
  if (!value.startsWith('/')) throw new Error('收录范围必须是站点内路径')
  const pathname = new URL(value, 'https://loci.invalid').pathname
  return pathname === '/' ? '/' : pathname.replace(/\/+$/u, '')
}

/** 使用路径段边界判断 URL 是否处于文档源的收录范围。 */
export function isUrlInScope(input: string, hostname: string, scopePath = '/'): boolean {
  try {
    const url = new URL(input)
    if (!allowedProtocols.has(url.protocol) || url.hostname !== hostname.toLowerCase()) return false
    const scope = normalizeScopePath(scopePath).replace(/\.mdx?$/iu, '') || '/'
    const pathname = url.pathname.replace(/\.mdx?$/iu, '') || '/'
    return scope === '/' || pathname === scope || pathname.startsWith(`${scope}/`)
  } catch {
    return false
  }
}
