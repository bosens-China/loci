import { and, asc, count, eq, gt, inArray, isNull } from 'drizzle-orm'
import type { DatabaseSync } from 'node:sqlite'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import type { EmbeddingChunkLocation } from './embedding-chunks.js'
import { documentEmbeddings, documents } from './drizzle-schema.js'
import { withImmediateTransaction } from './sqlite.js'

const input = { id: documents.id, title: documents.title, markdown: documents.markdown }

/** 向量可重建。正文改动的触发器和文档外键在原写入事务内清除失效向量。 */
export function createEmbeddingDatabase(database: DatabaseSync, drizzle: LociDrizzleDatabase) {
  return {
    embeddingCounts: (modelKey: string) => ({
      indexed: drizzle
        .select({ count: count() })
        .from(documentEmbeddings)
        .where(eq(documentEmbeddings.modelKey, modelKey))
        .get()!.count,
      total: drizzle.select({ count: count() }).from(documents).get()!.count
    }),
    nextUnindexedDocument: (modelKey: string, after: string) =>
      drizzle
        .select(input)
        .from(documents)
        .leftJoin(
          documentEmbeddings,
          and(
            eq(documentEmbeddings.documentId, documents.id),
            eq(documentEmbeddings.modelKey, modelKey)
          )
        )
        .where(and(isNull(documentEmbeddings.documentId), gt(documents.id, after)))
        .orderBy(asc(documents.id))
        .limit(1)
        .get(),
    storeDocumentEmbeddings: (
      modelKey: string,
      document: { id: string; title: string; markdown: string },
      chunks: EmbeddingChunkLocation[],
      vectors: Buffer
    ) =>
      withImmediateTransaction(database, () => {
        // 推理在事务外执行。比对读取时的正文，防止晚完成的任务恢复旧小节。
        const current = drizzle
          .select(input)
          .from(documents)
          .where(eq(documents.id, document.id))
          .get()
        if (!current || current.title !== document.title || current.markdown !== document.markdown)
          return false
        drizzle
          .insert(documentEmbeddings)
          .values({
            documentId: document.id,
            modelKey,
            chunks,
            vectors
          })
          .onConflictDoNothing()
          .run()
        return true
      }),
    listEmbeddingBatch: (modelKey: string, after: string, libraryIds?: readonly string[]) =>
      drizzle
        .select({
          id: documents.id,
          url: documents.url,
          relativePath: documents.relativePath,
          chunks: documentEmbeddings.chunks,
          vectors: documentEmbeddings.vectors
        })
        .from(documentEmbeddings)
        .innerJoin(documents, eq(documents.id, documentEmbeddings.documentId))
        .where(
          and(
            eq(documentEmbeddings.modelKey, modelKey),
            gt(documentEmbeddings.documentId, after),
            libraryIds?.length ? inArray(documents.sourceId, [...libraryIds]) : undefined
          )
        )
        .orderBy(asc(documentEmbeddings.documentId))
        .limit(32)
        .all()
  }
}

export type EmbeddingDatabase = ReturnType<typeof createEmbeddingDatabase>
