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

/** 从 URL 最后一个路径段生成候选标题，Markdown 清单可按需去除扩展名。 */
export function deriveUrlPathTitle(input: string, stripMarkdownExtension = false): string {
  const url = new URL(input)
  const segment = url.pathname.split('/').filter(Boolean).at(-1) || url.hostname
  let title = segment
  try {
    title = decodeURIComponent(segment)
  } catch {
    // 非法转义保留原始路径，不应影响页面发现。
  }
  return stripMarkdownExtension ? title.replace(/\.(?:md|markdown)$/iu, '') || url.hostname : title
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

/** 判断父范围是否完整包含子范围，用于区分扩大范围与可能裁剪正文的变更。 */
export function scopePathContains(parent: string, child: string): boolean {
  const normalizedParent = normalizeScope(parent)
  const normalizedChild = normalizeScope(child)
  return (
    normalizedParent === '/' ||
    normalizedParent === normalizedChild ||
    normalizedChild.startsWith(`${normalizedParent}/`)
  )
}

function normalizeScope(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed || '/'
}
