import type { IncomingMessage, ServerResponse } from 'node:http'
import { inspectSource } from '@loci/core'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/shared'
import { z } from 'zod'
import type { LocalRuntime } from './local-runtime.js'
import { handleAgentIntegrations } from './local-http-agent.js'
import { handleLocalBrowser } from './local-http-browser.js'
import { handleDataTransfer } from './local-http-data-transfer.js'
import type { createForegroundCrawls } from './local-http-crawls.js'
import { DocumentVersionConflict } from './document-mutation.js'
import { RuntimeLockedError } from './runtime-lock.js'
import { json, readJson, safeClientError } from './local-http-response.js'

const text = z.string().trim().min(1)
const strings = z.union([text, z.array(text).min(1)])
const number = z.number().int()
const optionalNumber = number.nullable().optional()
const documentFields = { title: text, content: z.string(), language: text.optional() }
const createDocument = z.strictObject({
  ...documentFields,
  path: text.optional(),
  url: z.httpUrl().optional()
})
const updateDocument = z.strictObject({ ...documentFields, expectedUpdatedAt: text }).partial()
const editSection = z.strictObject({
  action: z.enum(['add', 'update', 'delete']),
  sectionId: text.optional(),
  heading: text.optional(),
  level: number.min(1).max(6).optional(),
  content: z.string().optional(),
  expectedUpdatedAt: text.optional(),
  operationId: text.optional()
})
const source = z.strictObject({
  name: text,
  category: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  url: z.httpUrl(),
  kind: z.enum(['web', 'github']).optional(),
  mode: z.enum(['auto', 'http', 'browser']).optional(),
  pageLimit: number.optional(),
  scopePath: z.string().optional(),
  excludePathPattern: z.string().nullable().optional(),
  httpConcurrency: optionalNumber,
  browserConcurrency: optionalNumber,
  githubArchiveLimitMb: optionalNumber,
  githubMarkdownLimitMb: optionalNumber
})
const search = z.strictObject({
  queries: strings,
  libraryIds: z.array(text).optional(),
  pathPrefix: text.optional(),
  offset: number.optional(),
  limit: number.optional(),
  tree: z.boolean().optional()
})
const read = z.strictObject({
  libraryId: text.optional(),
  targets: strings,
  sectionId: text.optional(),
  offset: number.optional(),
  maxCharsPerFile: number.optional()
})
const settings = z.strictObject({
  theme: z.enum(['auto', 'light', 'dark']),
  httpConcurrency: number,
  browserConcurrency: number,
  maxRetries: number,
  batchIntervalSeconds: number,
  batchIntervalMaxSeconds: number,
  githubArchiveLimitMb: number,
  githubMarkdownLimitMb: number
})
const policy = z.strictObject({
  httpConcurrency: number.nullable(),
  browserConcurrency: number.nullable(),
  batchIntervalMinSeconds: number.nullable(),
  batchIntervalMaxSeconds: number.nullable()
})
const inspect = z.strictObject({
  url: z.httpUrl(),
  scopePath: text.optional(),
  excludePathPattern: text.nullable().optional()
})

/** 前台 Web 与 CLI 直接调用相同的运行时方法，所有 JSON 输入首先经过边界校验。 */
export async function handleLocalApi(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  crawls: ReturnType<typeof createForegroundCrawls>
): Promise<void> {
  const route = url.pathname
  const method = request.method
  const ok = (body: unknown, status = 200) => json(response, status, body)
  try {
    if (await handleLocalBrowser(runtime, request, response, url)) return
    if (await handleAgentIntegrations(runtime, request, response, url)) return
    if (await handleDataTransfer(runtime, request, response, url, () => crawls.clear())) return
    if (route === '/api/categories') {
      if (method === 'GET') return ok(runtime.listCategories())
      if (method === 'POST') {
        const { name } = z.strictObject({ name: text }).parse(await readJson(request))
        return ok(runtime.createCategory(name), 201)
      }
    }
    const category = /^\/api\/categories\/([^/]+)$/u.exec(route)
    if (category && method === 'DELETE')
      return ok({ deleted: runtime.deleteCategory(decodeURIComponent(category[1])) })
    if (route === '/api/libraries') {
      if (method === 'GET')
        return ok(
          runtime.listLibraries({
            query: url.searchParams.get('query') ?? undefined,
            category: url.searchParams.get('category') ?? undefined,
            version: url.searchParams.get('version') ?? undefined
          })
        )
      if (method === 'POST')
        return ok(runtime.createSource(source.parse(await readJson(request))), 201)
    }
    if (method === 'POST' && route === '/api/inspect')
      return ok(await inspectSource(inspect.parse(await readJson(request))))
    if (method === 'POST' && route === '/api/search')
      return ok(runtime.searchDocuments(search.parse(await readJson(request))))
    if (method === 'POST' && route === '/api/read')
      return ok(runtime.readDocuments(read.parse(await readJson(request))))
    if (method === 'GET' && route === '/api/libraries/crawl-status')
      return ok(runtime.listLibraryCrawlStatuses())
    const document = /^\/api\/documents\/([^/]+)(\/sections)?$/u.exec(route)
    if (document) {
      const id = decodeURIComponent(document[1])
      if (!runtime.database.getDocumentSourceId(id)) return ok({ error: '文档不存在' }, 404)
      if (!document[2] && method === 'GET') return ok(runtime.getDocument(id))
      if (!document[2] && method === 'PUT')
        return ok(runtime.updateDocument(id, updateDocument.parse(await readJson(request))))
      if (document[2] && method === 'GET') return ok(runtime.listDocumentSections(id))
      if (document[2] && method === 'POST')
        return ok(runtime.editDocumentSection(id, editSection.parse(await readJson(request))))
    }
    const library =
      /^\/api\/libraries\/([^/]+)(?:\/(tree|documents|sync|pages|crawl|crawl-status|crawl\/cancel))?$/u.exec(
        route
      )
    if (library) {
      const id = decodeURIComponent(library[1])
      const action = library[2]
      if (!action && method === 'DELETE') {
        runtime.deleteLibrary(id)
        return ok({ deleted: true })
      }
      if (!runtime.database.hasSource(id)) return ok({ error: '文档库不存在' }, 404)
      if (!action && method === 'GET')
        return ok(runtime.listLibraries(id).find((item) => item.id === id))
      if (!action && method === 'PUT')
        return ok(
          runtime.updateSource(id, {
            ...DOCUMENT_SOURCE_DEFAULTS,
            ...source.parse(await readJson(request))
          })
        )
      if (action === 'tree' && method === 'GET') {
        const queries = url.searchParams.getAll('queries')
        return ok(
          runtime.getLibraryTree(id, {
            parent: url.searchParams.get('parent') ?? undefined,
            depth: Number(url.searchParams.get('depth') ?? 1),
            queries: queries.length ? queries : undefined
          })
        )
      }
      if (action === 'crawl-status' && method === 'GET')
        return ok(runtime.getLibraryCrawlStatus(id))
      if (action === 'documents' && method === 'POST')
        return ok(runtime.createDocument(id, createDocument.parse(await readJson(request))), 201)
      if (action === 'documents' && method === 'DELETE')
        return ok(
          runtime.deleteDocuments(
            id,
            z.strictObject({ targets: strings }).parse(await readJson(request)).targets
          )
        )
      if (action === 'sync' && method === 'POST') return ok(crawls.start(id), 202)
      if (action === 'pages' && method === 'POST')
        return ok(
          crawls.start(
            id,
            z.strictObject({ urls: z.array(z.httpUrl()).min(1) }).parse(await readJson(request))
              .urls
          ),
          202
        )
      if (action === 'crawl' && method === 'GET') return ok(crawls.get(id))
      if (action === 'crawl/cancel' && method === 'POST') return ok(crawls.cancel(id))
    }
    if (route === '/api/settings') {
      if (method === 'GET') return ok(runtime.database.getSettings())
      if (method === 'PUT') return ok(runtime.saveSettings(settings.parse(await readJson(request))))
    }
    if (route === '/api/hostname-policies' && method === 'GET')
      return ok(runtime.database.listHostnameCrawlPolicies())
    const hostname = /^\/api\/hostname-policies\/([^/]+)$/u.exec(route)?.[1]
    if (hostname) {
      if (method === 'DELETE')
        return ok({
          deleted: runtime.deleteHostnameCrawlPolicy(decodeURIComponent(hostname))
        })
      if (method === 'PUT')
        return ok(
          runtime.saveHostnameCrawlPolicy({
            ...policy.parse(await readJson(request)),
            hostname: decodeURIComponent(hostname)
          })
        )
    }
    ok({ error: '接口不存在' }, 404)
  } catch (error) {
    ok(
      {
        error:
          error instanceof z.ZodError
            ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
            : safeClientError(error)
      },
      error instanceof RuntimeLockedError || error instanceof DocumentVersionConflict ? 409 : 400
    )
  }
}
