import { documentPath, type DocumentSearchHit, type DocumentSearchInput } from '@loci/shared'
import type { LociDatabase } from './database.js'
import { findBestPassage, readMarkdownSection } from './document-content-utils.js'
import type { EmbeddingChunkLocation } from './embedding-chunks.js'
import { embeddingIndexKey, type EmbeddingModel } from './embedding-catalog.js'

const candidatesPerQuery = 10

type Candidate = { documentId: string; location: EmbeddingChunkLocation; score: number }

/** 只比较同一模型内的余弦分数。查询范围与正文校验位于同一个读取快照。 */
export function searchEmbeddingSections(
  database: LociDatabase,
  model: EmbeddingModel,
  input: DocumentSearchInput,
  queries: readonly { query: string; vector: Float32Array }[]
): DocumentSearchHit[] {
  if (!queries.length || input.libraryIds?.length === 0) return []
  const prefix = input.pathPrefix?.replace(/\/+$/u, '')
  const searches = queries.map(() => new Map<string, Candidate>())
  const key = embeddingIndexKey(model)
  let after = ''
  while (true) {
    const batch = database.listEmbeddingBatch(key, after, input.libraryIds)
    if (!batch.length) break
    after = batch.at(-1)!.id
    for (const row of batch) {
      const path = documentPath({ url: row.url, relativePath: row.relativePath ?? undefined })
      if (prefix && path !== prefix && !path.startsWith(prefix + '/')) continue
      const bytes = row.vectors
      if (bytes.length !== row.chunks.length * model.dimensions * 4) continue
      const values = new Float32Array(
        bytes.byteOffset % 4 === 0 ? bytes.buffer : Uint8Array.from(bytes).buffer,
        bytes.byteOffset % 4 === 0 ? bytes.byteOffset : 0,
        bytes.length / 4
      )
      for (const [index, location] of row.chunks.entries()) {
        const sectionId = location.sectionIds[0]
        if (!sectionId) continue
        for (const [queryIndex, { vector }] of queries.entries()) {
          const candidates = searches[queryIndex]
          const offset = index * model.dimensions
          let score = 0
          for (let i = 0; i < vector.length; i++) score += vector[i] * values[offset + i]
          if (!Number.isFinite(score) || score <= (candidates.get(sectionId)?.score ?? -Infinity))
            continue
          candidates.set(sectionId, { documentId: row.id, location, score })
          if (candidates.size > candidatesPerQuery) {
            let worst: Candidate | undefined
            for (const candidate of candidates.values()) {
              if (!worst || candidate.score < worst.score) worst = candidate
            }
            candidates.delete(worst!.location.sectionIds[0])
          }
        }
      }
    }
  }
  const hits = new Map<string, DocumentSearchHit>()
  for (const [queryIndex, candidates] of searches.entries()) {
    for (const { documentId, location } of [...candidates.values()].sort(
      (a, b) => b.score - a.score
    )) {
      const document = database.getDocument(documentId)
      if (!document) continue
      const { content, ...summary } = document
      // 整篇或父小节共用一条向量时，在该片段覆盖的小节内定位可读原文。
      const passage =
        location.sectionIds.length > 1
          ? findBestPassage(
              content,
              queries[queryIndex].query,
              document.title,
              documentId,
              new Set(location.sectionIds)
            )
          : undefined
      const sectionId = passage?.sectionId ?? location.sectionIds[0]
      if (hits.has(sectionId)) continue
      const section = readMarkdownSection(content, sectionId, documentId, document.title)
      if (!section) continue
      const preview =
        passage?.paragraph ||
        (passage ? section.content : content.slice(location.startOffset, location.endOffset).trim())
      hits.set(sectionId, {
        ...summary,
        path: documentPath(summary),
        sectionId,
        sectionTitle: section.title,
        headingPath: passage ? section.headingPath : location.headingPath,
        paragraph: preview.slice(0, 320),
        truncated: preview.length > 320,
        matchesFrom: [model.id]
      })
    }
  }
  return [...hits.values()]
}
