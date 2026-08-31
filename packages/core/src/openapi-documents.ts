import {
  listOpenApiOperations,
  listOpenApiSchemas,
  renderOpenApiOperationMarkdown,
  renderOpenApiOverviewMarkdown,
  renderOpenApiSchemaMarkdown
} from './openapi-markdown.js'
import { stringValue } from './openapi-values.js'
import type { OpenApiEntry } from './openapi.js'

export interface ProjectedOpenApiDocument {
  url: string
  title: string
  relativePath: string
  markdown: string
}

export interface OpenApiDocumentProjection {
  total: number
  documents: Iterable<ProjectedOpenApiDocument>
}

interface OpenApiEntryProjection {
  entry: OpenApiEntry
  root: string
  operations: ReturnType<typeof listOpenApiOperations>
  models: ReturnType<typeof listOpenApiSchemas>
}

/** 先计算总篇数，再在迭代时逐篇渲染 Markdown，保证进度对应真实转换工作。 */
export function createOpenApiDocumentProjection(
  entries: readonly OpenApiEntry[]
): OpenApiDocumentProjection {
  const roots = allocateRoots(entries)
  const projections = entries.map((entry, index) => ({
    entry,
    root: roots[index] ?? '',
    operations: listOpenApiOperations(entry.document),
    models: listOpenApiSchemas(entry.document)
  }))
  return {
    total: projections.reduce(
      (count, projection) => count + 1 + projection.operations.length + projection.models.length,
      0
    ),
    documents: projectEntries(projections)
  }
}

/** 兼容需要一次性数组的调用方。 */
export function projectOpenApiDocuments(
  entries: readonly OpenApiEntry[]
): ProjectedOpenApiDocument[] {
  return [...createOpenApiDocumentProjection(entries).documents]
}

function* projectEntries(
  projections: readonly OpenApiEntryProjection[]
): Generator<ProjectedOpenApiDocument> {
  for (const projection of projections) yield* projectEntry(projection)
}

function* projectEntry({
  entry,
  root,
  operations,
  models
}: OpenApiEntryProjection): Generator<ProjectedOpenApiDocument> {
  const operationNames = new Map<string, Set<string>>()
  const modelNames = new Set<string>()
  const overviewPath = joinPath(root, 'index.md')
  yield {
    url: documentUrl(entry.url, overviewPath),
    title: entry.title,
    relativePath: overviewPath,
    markdown: renderOpenApiOverviewMarkdown(entry.document)
  }

  for (const operation of operations) {
    const tag = safeSegment(firstTag(operation.operation) ?? '未分组', '未分组')
    const usedNames = operationNames.get(tag) ?? new Set<string>()
    operationNames.set(tag, usedNames)
    const operationId = stringValue(operation.operation.operationId)
    const baseName = safeSegment(
      operationId ?? `${operation.method}-${operation.path}`,
      'interface'
    )
    const fallback = safeSegment(`${operation.method}-${operation.path}`, 'interface')
    const fileName = allocateFileName(baseName, fallback, usedNames)
    const relativePath = joinPath(root, tag, fileName)
    const title =
      stringValue(operation.operation.summary) ??
      operationId ??
      `${operation.method} ${operation.path}`
    yield {
      url: documentUrl(entry.url, relativePath),
      title,
      relativePath,
      markdown: renderOpenApiOperationMarkdown(entry.document, operation)
    }
  }

  for (const model of models) {
    const baseName = safeSegment(model.name, 'model')
    const fileName = allocateFileName(baseName, 'model', modelNames)
    const relativePath = joinPath(root, '数据模型', fileName)
    yield {
      url: documentUrl(entry.url, relativePath),
      title: model.name,
      relativePath,
      markdown: renderOpenApiSchemaMarkdown(model.name, model.schema)
    }
  }
}

function allocateRoots(entries: readonly OpenApiEntry[]): string[] {
  const used = new Set<string>()
  return entries.map((entry) => {
    if (!entry.groupName && entries.length === 1) return ''
    const base = safeSegment(entry.groupName ?? entry.title, 'OpenAPI')
    return allocateName(base, urlTail(entry.url), used)
  })
}

function allocateFileName(base: string, fallback: string, used: Set<string>): string {
  return `${allocateName(base, fallback, used)}.md`
}

function allocateName(base: string, fallback: string, used: Set<string>): string {
  const candidates = [base, `${base}-${fallback}`]
  for (const candidate of candidates) {
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  let index = 2
  while (used.has(`${base}-${fallback}-${index}`)) index += 1
  const name = `${base}-${fallback}-${index}`
  used.add(name)
  return name
}

function firstTag(operation: Record<string, unknown>): string | undefined {
  return Array.isArray(operation.tags)
    ? operation.tags.find((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
    : undefined
}

function safeSegment(input: string, fallback: string): string {
  const normalized = input
    .normalize('NFKC')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/[. ]+$/gu, '')
    .replace(/^-+/gu, '')
    .trim()
    .slice(0, 120)
  const safe = normalized && normalized !== '.' && normalized !== '..' ? normalized : fallback
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(safe) ? `_${safe}` : safe
}

function joinPath(...segments: string[]): string {
  return segments.filter(Boolean).join('/')
}

function urlTail(input: string): string {
  const url = new URL(input)
  return safeSegment(url.pathname.split('/').filter(Boolean).at(-1) ?? 'OpenAPI', 'OpenAPI')
}

function documentUrl(sourceUrl: string, relativePath: string): string {
  const url = new URL(sourceUrl)
  url.hash = `loci-openapi=${encodeURIComponent(relativePath)}`
  return url.toString()
}
