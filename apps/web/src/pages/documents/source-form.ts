import {
  DOCUMENT_SOURCE_DEFAULTS,
  normalizeCronSchedule,
  type CreateSourceInput,
  type FetchMode,
  type SourceKind,
  type UpdateSourceInput
} from '@loci/shared'
import type { LibraryCoreFormValue } from '@/components/library/LibraryCoreFields'

export interface SourceFormValue extends Omit<LibraryCoreFormValue, 'pageLimit'> {
  kind: SourceKind
  mode?: FetchMode
  pageLimit?: number
  excludePathPattern?: string
  httpConcurrency?: number
  browserConcurrency?: number
  githubArchiveLimitMb?: number
  githubMarkdownLimitMb?: number
}

/** 将可能尚未挂载高级字段的表单值补齐为稳定的本地文档源 API 输入。 */
export function toSourceInput(value: SourceFormValue): CreateSourceInput | UpdateSourceInput {
  const github = value.kind === 'github'
  return {
    name: value.name.trim(),
    url: value.url.trim(),
    kind: value.kind,
    mode: github ? DOCUMENT_SOURCE_DEFAULTS.mode : (value.mode ?? DOCUMENT_SOURCE_DEFAULTS.mode),
    pageLimit: value.pageLimit ?? DOCUMENT_SOURCE_DEFAULTS.pageLimit,
    scopePath: github ? DOCUMENT_SOURCE_DEFAULTS.scopePath : value.scopePath.trim() || '/',
    excludePathPattern: github ? null : value.excludePathPattern?.trim() || null,
    schedule: normalizeCronSchedule(value.schedule),
    httpConcurrency: github ? null : (value.httpConcurrency ?? null),
    browserConcurrency: github ? null : (value.browserConcurrency ?? null),
    githubArchiveLimitMb: github ? (value.githubArchiveLimitMb ?? null) : null,
    githubMarkdownLimitMb: github ? (value.githubMarkdownLimitMb ?? null) : null
  }
}
