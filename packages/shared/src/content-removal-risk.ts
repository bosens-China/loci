import type { SourceKind } from './api.js'
import { parseGithubRepositoryUrl } from './github-url.js'
import { scopePathContains } from './source-url.js'

export interface DocumentContentLocation {
  kind: SourceKind
  url: string
  scopePath: string
  excludePathPattern?: string | null
}

export type DocumentContentRemovalRisk = 'source_changed' | 'scope_narrowed' | 'exclusion_changed'

/** GitHub 库由仓库快照决定范围，网页库才按这两个可选字段裁剪。 */
export function getSourcePatchContentRemovalRisk(
  source: DocumentContentLocation,
  patch: Partial<Pick<DocumentContentLocation, 'scopePath' | 'excludePathPattern'>>
): DocumentContentRemovalRisk | null {
  return source.kind === 'web'
    ? getDocumentContentRemovalRisk(source, {
        ...source,
        scopePath: patch.scopePath ?? source.scopePath,
        excludePathPattern:
          patch.excludePathPattern === undefined
            ? source.excludePathPattern
            : patch.excludePathPattern
      })
    : null
}

/** 判断本地文档来源变更是否会在保存事务内裁剪既有正文。 */
export function getDocumentContentRemovalRisk(
  current: DocumentContentLocation,
  next: DocumentContentLocation
): DocumentContentRemovalRisk | null {
  const nextRepository = parseGithubRepositoryUrl(next.url)
  const sourceChanged =
    current.kind !== next.kind ||
    new URL(current.url).hostname !== new URL(next.url).hostname ||
    (next.kind === 'github' && current.url !== nextRepository?.url)
  if (sourceChanged) return 'source_changed'
  if (!scopePathContains(next.scopePath, current.scopePath)) return 'scope_narrowed'

  const nextExclusion = next.excludePathPattern?.trim() || null
  const currentExclusion = current.excludePathPattern?.trim() || null
  return nextExclusion !== null && nextExclusion !== currentExclusion ? 'exclusion_changed' : null
}
