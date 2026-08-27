import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CreateSourceInput, DocumentSource } from '@loci/shared'
import { count, eq, inArray } from 'drizzle-orm'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { documentMoveOperations, documents, documentSources } from './drizzle-schema.js'
import type { OperationLogDatabase } from './operation-log-database.js'
import { withImmediateTransaction } from './sqlite.js'

export interface MoveDocumentsInput {
  operationId?: string
  documentIds: string[]
  target: CreateSourceInput
  deleteEmptySources?: boolean
}

export interface MoveDocumentsResult {
  operationId: string
  target: DocumentSource
  moved: number
  deletedSourceIds: string[]
  reused: boolean
}

export function moveDocumentsToNewSource(
  database: DatabaseSync,
  drizzle: LociDrizzleDatabase,
  input: MoveDocumentsInput,
  createSource: (source: CreateSourceInput) => DocumentSource,
  readSource: (id: string) => DocumentSource,
  logs: OperationLogDatabase
): MoveDocumentsResult {
  const ids = [...new Set(input.documentIds)].sort()
  if (!ids.length) throw new Error('请选择至少一篇文档')
  const requestHash = digest(
    JSON.stringify({ ids, target: input.target, delete: input.deleteEmptySources !== false })
  )
  const operationId = input.operationId?.trim() || requestHash
  return withImmediateTransaction(database, () => {
    const previous = drizzle
      .select()
      .from(documentMoveOperations)
      .where(eq(documentMoveOperations.operationId, operationId))
      .get()
    if (previous) {
      if (previous.requestHash !== requestHash) {
        throw new Error('移动操作 ID 对应的请求内容不一致')
      }
      return {
        operationId,
        target: readSource(previous.targetSourceId),
        moved: previous.movedCount,
        deletedSourceIds: parseIds(previous.deletedSourceIdsJson),
        reused: true
      }
    }

    const existingSourceIds = new Set(
      drizzle
        .select({ id: documentSources.id })
        .from(documentSources)
        .all()
        .map((row) => row.id)
    )
    const rows = drizzle
      .select({
        id: documents.id,
        sourceId: documents.sourceId,
        sourceType: documentSources.sourceType
      })
      .from(documents)
      .innerJoin(documentSources, eq(documentSources.id, documents.sourceId))
      .where(inArray(documents.id, ids))
      .all()
    if (rows.length !== ids.length) throw new Error('部分待移动文档不存在，请重新读取文档列表')
    if (rows.some((row) => row.sourceType !== 'local')) throw new Error('云端副本文档不能直接移动')

    const target = createSource(input.target)
    if (existingSourceIds.has(target.id))
      throw new Error('目标文档库已经存在，请指定一个新的仓库地址')
    const sourceIds = [...new Set(rows.map((row) => row.sourceId))]
    drizzle.update(documents).set({ sourceId: target.id }).where(inArray(documents.id, ids)).run()
    updateSearchSourceIds(database, ids, target.id)

    const deletedSourceIds: string[] = []
    if (input.deleteEmptySources !== false) {
      for (const sourceId of sourceIds) {
        const remaining =
          drizzle
            .select({ value: count() })
            .from(documents)
            .where(eq(documents.sourceId, sourceId))
            .get()?.value ?? 0
        if (remaining > 0) continue
        drizzle.delete(documentSources).where(eq(documentSources.id, sourceId)).run()
        deletedSourceIds.push(sourceId)
      }
    }
    drizzle
      .insert(documentMoveOperations)
      .values({
        operationId,
        requestHash,
        targetSourceId: target.id,
        movedCount: ids.length,
        deletedSourceIdsJson: JSON.stringify(deletedSourceIds),
        createdAt: new Date().toISOString()
      })
      .run()
    logs.recordOperationLog({
      category: 'library',
      action: 'documents.move',
      level: 'info',
      resourceType: 'library',
      resourceId: target.id,
      hostname: new URL(target.url).hostname,
      message: `已移动 ${ids.length} 篇文档到 ${target.name}`,
      details: { operationId, deletedSourceIds }
    })
    return { operationId, target, moved: ids.length, deletedSourceIds, reused: false }
  })
}

function updateSearchSourceIds(database: DatabaseSync, ids: string[], targetId: string): void {
  const statement = database.prepare('UPDATE documents_fts SET source_id = ? WHERE document_id = ?')
  for (const id of ids) statement.run(targetId, id)
}

function parseIds(value: string): string[] {
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : []
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
