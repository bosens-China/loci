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
      s.id.toLowerCase().includes(q) ||
      (s.version ?? '').toLowerCase().includes(q)
  )
}

/**
 * 查找同一文档库在本地已收录的全部版本（同名或同 URL+收录范围），
 * 当前选中的版本排在最前，其余按版本号排序，供阅读工作台顶栏切换版本。
 */
export function findRelatedVersionLibraries<T extends LibrarySummary | DocumentSource>(
  sources: readonly T[],
  current: T
): T[] {
  const currentName = current.name.trim().toLowerCase()
  const currentOriginKey = `${current.url.trim().toLowerCase()}|${current.scopePath}`
  const siblings = sources.filter((item) => {
    if (item.id === current.id) return true
    if (item.name.trim().toLowerCase() === currentName) return true
    return `${item.url.trim().toLowerCase()}|${item.scopePath}` === currentOriginKey
  })
  return siblings.sort((a, b) => {
    if (a.id === current.id) return -1
    if (b.id === current.id) return 1
    return (a.version ?? '').localeCompare(b.version ?? '')
  })
}
