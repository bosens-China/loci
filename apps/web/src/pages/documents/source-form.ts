import {
  DEFAULT_LIBRARY_CATEGORY,
  DEFAULT_LIBRARY_VERSION,
  DOCUMENT_SOURCE_DEFAULTS,
  parseGithubRepositoryUrl,
  type CreateSourceInput,
  type FetchMode,
  type SourceKind
} from '@loci/shared'

export interface SourceFormValue {
  category?: string | null
  version?: string | null
  name: string
  url: string
  kind?: SourceKind
  mode?: FetchMode
  pageLimit?: number
  scopePath?: string
  excludePathPattern?: string | null
  httpConcurrency?: number | null
  browserConcurrency?: number | null
  githubArchiveLimitMb?: number | null
  githubMarkdownLimitMb?: number | null
}

/** 将可能尚未挂载高级字段的表单值补齐为符合契约的本地文档库 API 输入。 */
export function toSourceInput(value: SourceFormValue): CreateSourceInput {
  const trimmedUrl = value.url.trim()
  const github = Boolean(parseGithubRepositoryUrl(trimmedUrl))
  const name = value.name?.trim() || inferDefaultName(trimmedUrl)
  return {
    name,
    category: value.category?.trim() || DEFAULT_LIBRARY_CATEGORY,
    version: value.version?.trim() || DEFAULT_LIBRARY_VERSION,
    url: trimmedUrl,
    kind: github ? 'github' : 'web',
    mode: github ? DOCUMENT_SOURCE_DEFAULTS.mode : (value.mode ?? DOCUMENT_SOURCE_DEFAULTS.mode),
    pageLimit: value.pageLimit ?? DOCUMENT_SOURCE_DEFAULTS.pageLimit,
    scopePath: github ? DOCUMENT_SOURCE_DEFAULTS.scopePath : value.scopePath?.trim() || '/',
    excludePathPattern: github ? null : value.excludePathPattern?.trim() || null,
    httpConcurrency: value.httpConcurrency ?? null,
    browserConcurrency: value.browserConcurrency ?? null,
    githubArchiveLimitMb: github ? (value.githubArchiveLimitMb ?? null) : null,
    githubMarkdownLimitMb: github ? (value.githubMarkdownLimitMb ?? null) : null
  }
}

/** 根据 URL 推断简短默认库名 */
export function inferDefaultName(url: string): string {
  try {
    const parsed = new URL(url)
    const github = parseGithubRepositoryUrl(url)
    if (github) return `${github.owner}/${github.repo}`
    const pathParts = parsed.pathname.split('/').filter(Boolean)
    if (pathParts.length > 0) {
      return pathParts[0]!
    }
    return parsed.hostname
  } catch {
    return '新建文档库'
  }
}
