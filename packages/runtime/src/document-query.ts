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
    hits?: Map<string, DocumentSearchHit>,
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

  function searchDocuments(input: DocumentSearchInput): DocumentSearchResult {
    const offset = integer(input.offset ?? 0, 0)
    const limit = integer(input.limit ?? 20, 1)
    const { hits, retrieval } = matches(input)
    const rows = [...hits.values()]
    const page = rows.slice(offset, offset + limit)
    const result: DocumentSearchResult = {
      hits: [],
      total: rows.length,
      retrieval,
      ...(offset + limit < rows.length ? { nextOffset: offset + limit } : {})
    }
    if (input.tree) {
      const all = new Map(rows.map((row) => [row.document.id, hit(row)]))
      result.hits = page.map((row) => all.get(row.document.id)!)
      result.trees = [...new Set(rows.map((row) => row.document.sourceId))].map((libraryId) => ({
        libraryId,
        nodes: tree(libraryId, all)
      }))
    } else result.hits = page.map(hit)
    return result
  }

  function getLibraryTree(libraryId: string, options: LibraryTreeOptions = {}): UrlTreeNode[] {
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
    const roots = tree(libraryId, undefined, matchesById && new Set(matchesById.keys()))
    const nodes = getUrlTreeSlice(roots, parentId, depth) ?? []
    if (matchesById) {
      // 目录计数只需要元数据，展开的可见叶节点才读取 Markdown 和计算段落。
      const attach = (items: UrlTreeNode[]) => {
        for (const node of items) {
          const match = node.readable && matchesById.get(node.id)
          if (match) Object.assign(node, hit(match))
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
    getLibraryTree: (id: string, options?: LibraryTreeOptions) =>
      database.readSnapshot(() => getLibraryTree(id, options)),
    searchDocuments: (input: DocumentSearchInput) =>
      database.readSnapshot(() => searchDocuments(input)),
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

export type DocumentQuery = ReturnType<typeof createDocumentQuery>
