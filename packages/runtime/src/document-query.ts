import { createHash } from 'node:crypto'
import {
  buildUrlTree,
  documentPath,
  filterUrlTree,
  getUrlTreeSlice,
  type DocumentReadInput,
  type DocumentReadResult,
  type DocumentSearchHit,
  type DocumentSearchInput,
  type DocumentSearchResult,
  type DocumentSummary,
  type LibraryFilters,
  type LibrarySummary,
  type LibraryTreeOptions,
  type UrlTreeNode
} from '@loci/shared'
import { acquireCrawlRuntimeLock } from './runtime-lock.js'
import type { LociDatabase } from './database.js'
import { findBestPassage, readMarkdownSection, sliceContent } from './document-content-utils.js'

export class SearchPageChangedError extends Error {
  constructor() {
    super('搜索结果已更新，请从第一页重新查询')
    this.name = 'SearchPageChangedError'
  }
}

function searchPage(input: DocumentSearchInput, offset: number, limit: number, keys: string[]) {
  const nextOffset = offset + limit
  if (nextOffset >= keys.length && !input.pageToken) return {}
  const token = createHash('sha256')
    .update(JSON.stringify([input.queries, input.libraryIds, input.pathPrefix, keys]))
    .digest('hex')
  if (input.pageToken && input.pageToken !== token) throw new SearchPageChangedError()
  return nextOffset < keys.length ? { nextOffset, nextPageToken: token } : {}
}

function strings(value: string | readonly string[], label: string): string[] {
  const values = typeof value === 'string' ? [value] : value
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.some((v) => typeof v !== 'string' || !v.trim())
  )
    throw new Error(`${label}不能为空`)
  return [...new Set(values.map((v) => v.trim()))]
}

function integer(value: number, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`数值必须是大于或等于 ${minimum} 的整数`)
  return value
}

function within(path: string, prefix: string): boolean {
  if (!prefix.startsWith('/')) throw new Error('目录路径必须以 / 开头')
  const normalized = prefix.replace(/\/+$/u, '')
  return path === normalized || path.startsWith(normalized + '/')
}

/** 搜索、树遍历和变更目标解析共用逻辑路径，支持 GitHub 与 OpenAPI 虚拟文档。 */
export function createDocumentQuery(database: LociDatabase, dataDir: string, owner = 'Loci') {
  function mutate<T>(id: string, action: () => T): T {
    const lock = acquireCrawlRuntimeLock(dataDir, id, `${owner} 删除文档`)
    try {
      return action()
    } finally {
      lock.release()
    }
  }
  function listLibraries(input: LibraryFilters | string = {}): LibrarySummary[] {
    const filters = typeof input === 'string' ? { query: input } : input
    const languages = new Map<string, string[]>()
    for (const row of database.listLanguages()) {
      const values = languages.get(row.sourceId) ?? []
      values.push(row.language)
      languages.set(row.sourceId, values)
    }
    const term = filters.query?.trim().toLowerCase() ?? ''
    return database
      .listSources(filters)
      .filter((s) => [s.name, s.id, s.url].some((v) => v.toLowerCase().includes(term)))
      .map((s) => ({ ...s, pageCount: s.pages, languages: languages.get(s.id) ?? [] }))
  }

  function requireLibrary(id: string) {
    if (!database.hasSource(id)) throw new Error('文档库不存在')
  }

  function matches(input: DocumentSearchInput) {
    const hits = new Map<string, { document: DocumentSummary; queries: string[] }>()
    const retrieval: DocumentSearchResult['retrieval'] = []
    const libraryIds = input.libraryIds && new Set(input.libraryIds)
    if (input.pathPrefix !== undefined) within('/', input.pathPrefix)
    for (const query of strings(input.queries, '关键词')) {
      for (const mode of ['all', 'any', 'fuzzy'] as const) {
        const documents = database
          .searchDocumentSummaries(
            query,
            libraryIds?.size === 1 ? [...libraryIds][0] : undefined,
            mode
          )
          .filter(
            (d) =>
              (!libraryIds || libraryIds.has(d.sourceId)) &&
              (!input.pathPrefix || within(documentPath(d), input.pathPrefix))
          )
        if (!documents.length && mode !== 'fuzzy') continue
        retrieval.push({ query, mode })
        for (const document of documents) {
          const previous = hits.get(document.id)
          if (previous) previous.queries.push(query)
          else hits.set(document.id, { document, queries: [query] })
        }
        break
      }
    }
    return { hits, retrieval }
  }

  function hit({
    document,
    queries
  }: {
    document: DocumentSummary
    queries: string[]
  }): DocumentSearchHit {
    const record = database.getDocument(document.id)
    if (!record) throw new Error('文档已变化，请重试')
    return {
      ...document,
      path: documentPath(document),
      ...findBestPassage(record.content, queries.join(' '), document.title, document.id)
    }
  }

  function tree(
    id: string,
    hits?: Map<string, DocumentSearchHit & { sectionIds?: string[] }>,
    matchedIds?: ReadonlySet<string>
  ): UrlTreeNode[] {
    const documents = database.listDocumentSummaries(id)
    const nodes = buildUrlTree(
      documents.map((d) => hits?.get(d.id) ?? d),
      id
    )
    const selected = matchedIds ?? (hits ? new Set(hits.keys()) : undefined)
    return selected ? filterUrlTree(nodes, selected) : nodes
  }

  function searchDocuments(
    input: DocumentSearchInput,
    semantic: DocumentSearchHit[][] = []
  ): DocumentSearchResult {
    const offset = integer(input.offset ?? 0, 0)
    const limit = integer(input.limit ?? 20, 1)
    const { hits, retrieval } = matches(input)
    const rows = [...hits.values()]
    const versions = new Map<string, string>()
    const withDetails = (matches: DocumentSearchHit[]) =>
      matches.map((match) => {
        const libraryVersion =
          versions.get(match.sourceId) ?? database.getSource(match.sourceId).version
        versions.set(match.sourceId, libraryVersion)
        if (!input.includeContent) return { ...match, libraryVersion }
        const document = database.getDocument(match.id)
        const section =
          document &&
          readMarkdownSection(document.content, match.sectionId, match.id, document.title)
        if (!section) throw new Error('小节已变化，请重试')
        return {
          ...match,
          libraryVersion,
          headingPath: section.headingPath,
          content: section.content
        }
      })
    if (semantic.some((group) => group.length)) {
      const merged = mergeSections([
        rows.map((row) => ({
          ...hit(row),
          matchesFrom: ['keyword']
        })),
        ...semantic
      ])
      const page = searchPage(
        input,
        offset,
        limit,
        merged.map((row) => row.sectionId)
      )
      const hitsByDocument = input.tree ? groupSectionsByDocument(merged) : undefined
      return {
        hits: withDetails(merged.slice(offset, offset + limit)),
        total: merged.length,
        retrieval,
        ...page,
        ...(input.tree
          ? {
              trees: [...new Set(merged.map((row) => row.sourceId))].map((libraryId) => ({
                libraryId,
                nodes: tree(libraryId, hitsByDocument)
              }))
            }
          : {})
      }
    }
    const page = rows.slice(offset, offset + limit)
    const result: DocumentSearchResult = {
      hits: [],
      total: rows.length,
      retrieval,
      ...searchPage(
        input,
        offset,
        limit,
        rows.map((row) => row.document.id)
      )
    }
    if (input.tree) {
      const all = new Map(rows.map((row) => [row.document.id, hit(row)]))
      result.hits = page.map((row) => all.get(row.document.id)!)
      result.trees = [...new Set(rows.map((row) => row.document.sourceId))].map((libraryId) => ({
        libraryId,
        nodes: tree(libraryId, all)
      }))
    } else result.hits = page.map(hit)
    result.hits = withDetails(result.hits)
    return result
  }

  function getLibraryTree(
    libraryId: string,
    options: LibraryTreeOptions = {},
    semantic: DocumentSearchHit[][] = []
  ): UrlTreeNode[] {
    requireLibrary(libraryId)
    const depth = integer(options.depth ?? 1, 1)
    const matchesById =
      options.queries === undefined
        ? undefined
        : matches({ queries: options.queries, libraryIds: [libraryId] }).hits
    const parent = options.parent?.startsWith('/')
      ? options.parent.split('/').filter(Boolean).join('/')
      : undefined
    const parentId =
      parent === undefined ? options.parent : parent ? `folder:${libraryId}:${parent}` : undefined
    let matched = matchesById && new Set(matchesById.keys())
    const semanticHits = groupSectionsByDocument(mergeSections(semantic))
    if (matched) matched = new Set([...matched, ...semanticHits.keys()])
    const roots = tree(libraryId, undefined, matched)
    const nodes = getUrlTreeSlice(roots, parentId, depth) ?? []
    if (matchesById) {
      // 目录计数只需要元数据，展开的可见叶节点才读取 Markdown 和计算段落。
      const attach = (items: UrlTreeNode[]) => {
        for (const node of items) {
          if (node.readable) {
            const match = matchesById.get(node.id)
            const semanticHit = semanticHits.get(node.id)
            if (match || semanticHit) Object.assign(node, match ? hit(match) : semanticHit)
            if (match && semanticHit) {
              const ids = [
                ...new Set([
                  node.sectionId!,
                  ...(semanticHit.sectionIds ?? [semanticHit.sectionId])
                ])
              ]
              if (ids.length > 1) node.sectionIds = ids
            }
          }
          if (node.children) attach(node.children)
        }
      }
      attach(nodes)
    }
    return nodes
  }

  function resolveTargets(
    libraryId: string | undefined,
    input: DocumentReadInput['targets'],
    allowMissing: boolean
  ): DocumentSummary[] {
    if (libraryId !== undefined) requireLibrary(libraryId)
    const documents = database.listDocumentSummaries(libraryId)
    const selected = new Set<string>()
    for (const target of strings(input, '文档目标')) {
      const path = target.startsWith('/')
      const exact = path ? undefined : documents.find((d) => d.id === target)
      const matching = exact
        ? [exact]
        : documents.filter((d) =>
            path ? within(documentPath(d), target) : d.id.startsWith(target)
          )
      if (!path && matching.length > 1) throw new Error(`文档短 ID 不唯一：${target}`)
      if (!matching.length && !allowMissing) throw new Error(`未找到文档目标：${target}`)
      for (const document of matching) selected.add(document.id)
    }
    const byId = new Map(documents.map((d) => [d.id, d]))
    const groups = new Map<string, DocumentSummary[]>()
    for (const document of documents) {
      if (!selected.has(document.id)) continue
      const group = groups.get(document.sourceId) ?? []
      group.push(document)
      groups.set(document.sourceId, group)
    }
    const ordered: DocumentSummary[] = []
    function visit(nodes: UrlTreeNode[]) {
      for (const node of nodes) {
        if (node.readable) ordered.push(byId.get(node.id)!)
        else if (node.children) visit(node.children)
      }
    }
    for (const id of [...groups.keys()].sort()) visit(buildUrlTree(groups.get(id)!, id))
    return ordered
  }

  function readDocuments(input: DocumentReadInput): DocumentReadResult[] {
    const offset = integer(input.offset ?? 0, 0)
    const limit = integer(input.maxCharsPerFile ?? 20000, 1)
    return resolveTargets(input.libraryId, input.targets, false).map((d) => {
      const document = database.getDocument(d.id)
      if (!document) throw new Error('文档已变化，请重试')
      const section =
        input.sectionId === undefined
          ? undefined
          : readMarkdownSection(document.content, input.sectionId, d.id, d.title)
      if (input.sectionId !== undefined && !section) throw new Error('小节不存在或与文档不匹配')
      return {
        ...d,
        path: documentPath(d),
        ...sliceContent(section?.content ?? document.content, offset, limit),
        ...(section ? { sectionId: input.sectionId } : {})
      }
    })
  }

  return {
    listLibraries: (filters?: LibraryFilters | string) =>
      database.readSnapshot(() => listLibraries(filters)),
    getLibraryTree: (
      id: string,
      options?: LibraryTreeOptions,
      candidates?: () => DocumentSearchHit[][]
    ) => database.readSnapshot(() => getLibraryTree(id, options, candidates?.())),
    searchDocuments: (input: DocumentSearchInput, candidates?: () => DocumentSearchHit[][]) =>
      database.readSnapshot(() => searchDocuments(input, candidates?.())),
    readDocuments: (input: DocumentReadInput) => database.readSnapshot(() => readDocuments(input)),
    deleteDocuments: (libraryId: string, targets: DocumentReadInput['targets']) =>
      mutate(libraryId, () => {
        database.getSourceConfig(libraryId)
        const documents = resolveTargets(libraryId, targets, true)
        database.deleteDocumentUrls(
          libraryId,
          documents.map((d) => d.url)
        )
        return { deleted: documents.length }
      }),
    deleteLibrary: (libraryId: string) => mutate(libraryId, () => database.deleteSource(libraryId))
  }
}

/** 各路保留自己的顺序，轮流取候选，让分页不会被单一路来源占满。 */
function mergeSections(groups: DocumentSearchHit[][]): DocumentSearchHit[] {
  const selected = new Map<string, DocumentSearchHit>()
  const length = Math.max(0, ...groups.map((group) => group.length))
  for (let index = 0; index < length; index++) {
    for (const group of groups) {
      const hit = group[index]
      if (!hit) continue
      const key = JSON.stringify([hit.sourceId, hit.id, hit.sectionId])
      const previous = selected.get(key)
      if (previous) {
        previous.matchesFrom = [
          ...new Set([...(previous.matchesFrom ?? []), ...(hit.matchesFrom ?? [])])
        ]
        previous.headingPath ??= hit.headingPath
      } else selected.set(key, { ...hit })
    }
  }
  return [...selected.values()]
}

function groupSectionsByDocument(hits: DocumentSearchHit[]) {
  const grouped = new Map<string, DocumentSearchHit & { sectionIds?: string[] }>()
  for (const hit of hits) {
    const previous = grouped.get(hit.id)
    if (!previous) {
      grouped.set(hit.id, { ...hit })
      continue
    }
    const ids = previous.sectionIds ?? [previous.sectionId]
    if (!ids.includes(hit.sectionId)) ids.push(hit.sectionId)
    if (ids.length > 1) previous.sectionIds = ids
  }
  return grouped
}

export type DocumentQuery = ReturnType<typeof createDocumentQuery>
