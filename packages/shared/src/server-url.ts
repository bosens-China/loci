/** 统一后端地址，确保来源比较、公开目录和管理员登录使用同一标识。 */
export function normalizeServerUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('请输入有效的后端地址')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('后端地址仅支持 HTTP 或 HTTPS')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('后端地址不能包含账号、查询参数或锚点')
  }
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${path === '/' ? '' : path}`
}
