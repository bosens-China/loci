import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { normalizeUrl } from '@loci/core'
import { documentPath } from '@loci/shared'
import type {
  CreateDocumentInput,
  DocumentDetail,
  DocumentSectionDetail,
  EditDocumentSectionInput,
  UpdateDocumentInput
} from '@loci/shared'
import { and, eq } from 'drizzle-orm'
import type { LociDatabase } from './database.js'
import { readSourceConfig } from './database-local-source.js'
import { replaceDocumentIndex } from './document-content-database.js'
import { editMarkdownSection, listMarkdownSections } from './document-content-utils.js'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { documents, sectionEditReceipts } from './drizzle-schema.js'
import { withImmediateTransaction } from './sqlite.js'

export class DocumentVersionConflict extends Error {
  constructor() {
    super('文档已被修改，请重新加载后再编辑')
  }
}

function nonempty(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`)
  return value.trim()
}

function location(base: string, input: CreateDocumentInput) {
  if ((input.path === undefined) === (input.url === undefined))
    throw new Error('请提供 path 或 url 其中一项')
  let relativePath: string
  let url: string
  if (input.path !== undefined) {
    const segments = nonempty(input.path, '路径').replaceAll('\\', '/').split('/').filter(Boolean)
    if (!segments.length || segments.some((segment) => ['.', '..'].includes(segment)))
      throw new Error('文档路径无效')
    relativePath = segments.join('/')
    url = new URL('/' + segments.map(encodeURIComponent).join('/'), base).href
  } else {
    url = normalizeUrl(nonempty(input.url!, 'URL'))
    relativePath = new URL(url).pathname.split('/').filter(Boolean).join('/')
  }
  return { url, relativePath }
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

function assertDocumentVersion(updatedAt: string, expected: string | undefined): void {
  if (expected !== undefined && updatedAt !== expected) throw new DocumentVersionConflict()
}

/** 在持有来源锁后开启写事务，重读文档以处理跨进程移动或删除。 */
export function createMutationDatabase(sqlite: DatabaseSync, db: LociDrizzleDatabase) {
  function updateRow(
    id: string,
    sourceId: string,
    patch: (row: typeof documents.$inferSelect) => UpdateDocumentInput
  ) {
    return withImmediateTransaction(sqlite, () => {
      readSourceConfig(db, sourceId)
      const row = db
        .select()
        .from(documents)
        .where(and(eq(documents.id, id), eq(documents.sourceId, sourceId)))
        .get()
      if (!row) throw new Error('文档不存在或已移动')
      const input = patch(row)
      const title = input.title === undefined ? row.title : nonempty(input.title, '标题')
      const language =
        input.language === undefined ? row.language : nonempty(input.language, '语言')
      const markdown = input.content ?? row.markdown
      if (title === row.title && language === row.language && markdown === row.markdown) return
      db.update(documents)
        .set({
          title,
          markdown,
          language,
          crawledAt: new Date(Math.max(Date.now(), Date.parse(row.crawledAt) + 1)).toISOString()
        })
        .where(eq(documents.id, id))
        .run()
      replaceDocumentIndex(sqlite, id, sourceId, title, markdown)
    })
  }
  return {
    insertLocalDocument: (sourceId: string, input: CreateDocumentInput) =>
      withImmediateTransaction(sqlite, () => {
        const source = readSourceConfig(db, sourceId)
        const { url, relativePath } = location(source.firstUrl, input)
        const title = nonempty(input.title, '标题')
        const language = nonempty(input.language ?? 'und', '语言')
        const markdown = input.content
        if (typeof markdown !== 'string') throw new Error('正文必须为字符串')
        const previous = db
          .select()
          .from(documents)
          .where(and(eq(documents.sourceId, sourceId), eq(documents.url, url)))
          .get()
        if (previous) {
          if (
            previous.title === title &&
            previous.markdown === markdown &&
            previous.language === language
          )
            return previous.id
          throw new Error('该 URL 的文档已存在')
        }
        const id = randomUUID()
        db.insert(documents)
          .values({
            id,
            sourceId,
            title,
            url,
            relativePath,
            language,
            markdown,
            crawledAt: new Date().toISOString(),
            manual: 1,
            fetchMode: 'http'
          })
          .run()
        replaceDocumentIndex(sqlite, id, sourceId, title, markdown)
        return id
      }),
    updateLocalDocument: (id: string, sourceId: string, input: UpdateDocumentInput) =>
      updateRow(id, sourceId, (row) => {
        assertDocumentVersion(row.crawledAt, input.expectedUpdatedAt)
        return input
      }),
    editLocalSection: (id: string, sourceId: string, input: EditDocumentSectionInput) =>
      updateRow(id, sourceId, (row) => {
        const requestHash = hash(
          JSON.stringify([
            input.action,
            input.sectionId,
            input.heading,
            input.level,
            input.content,
            ...(input.expectedUpdatedAt === undefined ? [] : [input.expectedUpdatedAt])
          ])
        )
        const explicit = input.operationId !== undefined
        // 无操作 ID 时仅复用当前正文上的最近一次相同修改，避免位置小节 ID 在重试时误删下一节。
        const operationId = explicit ? `key:${nonempty(input.operationId!, '操作 ID')}` : 'last'
        const receipt = db
          .select()
          .from(sectionEditReceipts)
          .where(
            and(
              eq(sectionEditReceipts.documentId, id),
              eq(sectionEditReceipts.operationId, operationId)
            )
          )
          .get()
        if (explicit && receipt && receipt.requestHash !== requestHash)
          throw new Error('操作 ID 已用于不同的小节修改')
        if (
          receipt?.requestHash === requestHash &&
          (explicit || receipt.resultHash === hash(row.markdown))
        )
          return {}
        assertDocumentVersion(row.crawledAt, input.expectedUpdatedAt)
        const content = editMarkdownSection(row.markdown, row.title, id, input)
        const resultHash = hash(content)
        db.insert(sectionEditReceipts)
          .values({ documentId: id, operationId, requestHash, resultHash })
          .onConflictDoUpdate({
            target: [sectionEditReceipts.documentId, sectionEditReceipts.operationId],
            set: { requestHash, resultHash }
          })
          .run()
        return { content }
      })
  }
}

export type MutationDatabase = ReturnType<typeof createMutationDatabase>

type SourceMutation = <T>(sourceId: string, label: string, action: () => T) => T

export function createDocumentMutation(db: LociDatabase, mutate: SourceMutation) {
  function document(id: string): DocumentDetail {
    const record = db.getDocument(id)
    if (!record) throw new Error('文档不存在')
    return { ...record, path: documentPath(record) }
  }
  function edit(id: string, apply: (sourceId: string) => void) {
    const sourceId = db.getDocumentSourceId(id)
    if (!sourceId) throw new Error('文档不存在')
    return mutate(sourceId, '编辑文档', () => {
      apply(sourceId)
      return document(id)
    })
  }
  return {
    getDocument: document,
    createDocument: (libraryId: string, input: CreateDocumentInput) =>
      mutate(libraryId, '创建文档', () => document(db.insertLocalDocument(libraryId, input))),
    updateDocument: (id: string, input: UpdateDocumentInput) =>
      edit(id, (sourceId) => db.updateLocalDocument(id, sourceId, input)),
    listDocumentSections: (id: string): DocumentSectionDetail[] => {
      const { title, content, updatedAt } = document(id)
      return listMarkdownSections(content, title, id).map((section) => ({ ...section, updatedAt }))
    },
    editDocumentSection: (id: string, input: EditDocumentSectionInput) =>
      edit(id, (sourceId) => db.editLocalSection(id, sourceId, input))
  }
}

export type DocumentMutation = ReturnType<typeof createDocumentMutation>
