import type { DocumentSource } from '@loci/shared'

export type LibraryKindFilter = 'all' | 'web' | 'github' | 'cloud'

export interface LibraryFilterCounts {
  total: number
  web: number
  github: number
  cloud: number
}

/** 统计各类本地文档库数量。 */
export function countLocalLibrarySources(sources: DocumentSource[]): LibraryFilterCounts {
  const total = sources.length
  const web = sources.filter((s) => s.kind === 'web' && !s.cloud).length
  const github = sources.filter((s) => s.kind === 'github').length
  const cloud = sources.filter((s) => Boolean(s.cloud)).length
  return { total, web, github, cloud }
}

/** 根据来源类型和关键词组合过滤本地文档库列表。 */
export function filterLocalLibrarySources(
  sources: DocumentSource[],
  filter: { kind: LibraryKindFilter; keyword: string }
): DocumentSource[] {
  let list = sources

  if (filter.kind === 'web') {
    list = list.filter((s) => s.kind === 'web' && !s.cloud)
  } else if (filter.kind === 'github') {
    list = list.filter((s) => s.kind === 'github')
  } else if (filter.kind === 'cloud') {
    list = list.filter((s) => Boolean(s.cloud))
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
