export interface SourceScopeOption {
  label: string
  value: string
}

const genericSubdomains = new Set(['api', 'developer', 'developers', 'doc', 'docs', 'guide', 'www'])

function sourceUrl(input: string): URL | undefined {
  try {
    const url = new URL(input.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

/** 从主域名生成易编辑的默认名称，常见文档子域名会被忽略。 */
export function deriveSourceName(input: string): string {
  const url = sourceUrl(input)
  if (!url) return ''
  const labels = url.hostname.toLowerCase().split('.').filter(Boolean)
  if (labels.length === 1) return labels[0] ?? ''
  const first = labels[0] ?? ''
  return genericSubdomains.has(first) && labels.length > 2 ? (labels[1] ?? first) : first
}

/** 把 URL 路径转换为从整站到当前路径的离散收录范围。 */
export function getSourceScopeOptions(input: string): SourceScopeOption[] {
  const url = sourceUrl(input)
  if (!url) return []
  const options: SourceScopeOption[] = [{ label: '整个站点', value: '/' }]
  let path = ''
  for (const segment of url.pathname.split('/').filter(Boolean)) {
    path += `/${segment}`
    options.push({ label: path, value: path })
  }
  return options
}
