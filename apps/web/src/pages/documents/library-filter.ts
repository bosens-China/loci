import type { DocumentSource, LibrarySummary } from '@loci/shared'

export type LibraryKindFilter = 'all' | 'web' | 'github'

export interface LibraryFilterCounts {
  total: number
  web: number
  github: number
}

/** 统计各类本地文档库数量。 */
export function countLocalLibrarySources(
  sources: Array<LibrarySummary | DocumentSource>
): LibraryFilterCounts {
  const total = sources.length
  const web = sources.filter((s) => s.kind === 'web').length
  const github = sources.filter((s) => s.kind === 'github').length
  return { total, web, github }
}

/** 根据来源类型和关键词组合过滤本地文档库列表。 */
export function filterLocalLibrarySources<T extends LibrarySummary | DocumentSource>(
  sources: T[],
  filter: { kind: LibraryKindFilter; keyword: string; category?: string }
): T[] {
  let list = filter.category
    ? sources.filter((source) => source.category === filter.category)
    : sources

  if (filter.kind === 'web') {
    list = list.filter((s) => s.kind === 'web')
  } else if (filter.kind === 'github') {
    list = list.filter((s) => s.kind === 'github')
  }

  const q = filter.keyword.trim().toLowerCase()
  if (!q) return list

  return list.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.url.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q)
  )
}
