import type { DocumentRecord, DocumentSource } from '@loci/shared'
import * as z from 'zod/v4'
import { toSearchTokens } from '../database-values.js'
import { findBestPassage } from './content.js'
import { paginationInput, searchOutputSchema } from './schemas.js'
import type { LociMcpServices } from './services.js'
import { page, readAnnotations, result } from './server-support.js'
import type { LociToolRegistrar } from './tool-registry.js'

type RetrievalMode = 'all_terms' | 'any_terms' | 'fuzzy'

export function registerSearchTool(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
    'loci_search_files',
    {
      title: '搜索文件正文',
      description:
        '一次搜索多组标题和 Markdown 正文；严格搜索无结果时自动放宽，并可用 path_prefix 限定路径。按查询分组返回段落、section_id 和 file_id。',
      inputSchema: z
        .object({
          queries: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
          library_ids: z.array(z.string().min(1)).max(20).optional(),
          path_prefix: z.string().trim().startsWith('/').optional(),
          ...paginationInput
        })
        .strict(),
      outputSchema: searchOutputSchema,
      annotations: readAnnotations()
    },
    ({ queries, library_ids, path_prefix, offset, limit }) => {
      const sourceById = new Map(services.listSources().map((source) => [source.id, source]))
      const libraryScope = library_ids ? new Set(library_ids) : undefined
      const results = queries.map((query) => {
        const found = searchWithFallback(services, query, libraryScope, path_prefix)
        const matches = rankDocuments(found.documents, query, sourceById)
        const hits = matches.slice(offset, offset + limit).map((document) => {
          const passage = findBestPassage(document.content, query, document.title, document.id)
          return {
            file_id: document.id,
            library_id: document.sourceId,
            file_title: document.title,
            section_id: passage.sectionId,
            section_title: passage.sectionTitle,
            path: document.folder,
            source_url: document.url,
            paragraph: passage.paragraph,
            truncated: passage.truncated
          }
        })
        return {
          query,
          retrieval_mode: found.mode,
          fallback_used: found.mode !== 'all_terms',
          ...page(hits, matches.length, offset, limit)
        }
      })
      return result({ results }, `完成 ${results.length} 组文档搜索`)
    }
  )
}

function searchWithFallback(
  services: LociMcpServices,
  query: string,
  libraryScope: ReadonlySet<string> | undefined,
  pathPrefix: string | undefined
): { mode: RetrievalMode; documents: DocumentRecord[] } {
  const attempts = [
    ['all_terms', 'all'],
    ['any_terms', 'any'],
    ['fuzzy', 'fuzzy']
  ] as const
  for (const [mode, databaseMode] of attempts) {
    const documents = services
      .searchDocuments(query, databaseMode)
      .filter(
        (document) =>
          (!libraryScope || libraryScope.has(document.sourceId)) &&
          (!pathPrefix || isPathInPrefix(document.url, pathPrefix))
      )
    if (documents.length) return { mode, documents }
  }
  return { mode: 'fuzzy', documents: [] }
}

function rankDocuments(
  documents: readonly DocumentRecord[],
  query: string,
  sourceById: ReadonlyMap<string, DocumentSource>
): DocumentRecord[] {
  const tokens = toSearchTokens(query).map((token) => token.toLocaleLowerCase())
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return documents
    .map((document, index) => ({
      document,
      score:
        documentScore(document, normalizedQuery, tokens, sourceById.get(document.sourceId)) -
        index / 10_000
    }))
    .sort((left, right) => right.score - left.score)
    .map((item) => item.document)
}

function documentScore(
  document: DocumentRecord,
  query: string,
  tokens: readonly string[],
  source: DocumentSource | undefined
): number {
  const title = document.title.toLocaleLowerCase()
  const path = new URL(document.url).pathname.toLocaleLowerCase()
  const titleHits = tokens.filter((token) => title.includes(token)).length
  const pathHits = tokens.filter((token) => path.includes(token)).length
  const exactTitle = title.includes(query) ? 20 : 0
  const seedDistance = source ? commonPathSegments(source.url, document.url) / 4 : 0
  return exactTitle + titleHits * 8 + pathHits * 4 + seedDistance
}

function isPathInPrefix(url: string, input: string): boolean {
  const path = new URL(url).pathname.replace(/\/+$/u, '') || '/'
  const prefix = input.replace(/\/+$/u, '') || '/'
  return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`)
}

function commonPathSegments(left: string, right: string): number {
  const leftUrl = new URL(left)
  const rightUrl = new URL(right)
  if (leftUrl.hostname !== rightUrl.hostname) return 0
  const leftParts = leftUrl.pathname.split('/').filter(Boolean)
  const rightParts = rightUrl.pathname.split('/').filter(Boolean)
  let count = 0
  while (leftParts[count] && leftParts[count] === rightParts[count]) count += 1
  return count
}
