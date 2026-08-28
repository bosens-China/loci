import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { HTTPException } from 'hono/http-exception'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  DOCUMENT_SOURCE_LIMITS,
  normalizeCronSchedule,
  normalizeScopePath,
  parseLibraryPublishArchive
} from '@loci/core'
import { z } from 'zod'
import {
  APP_SETTINGS_LIMITS,
  SERVER_CRAWL_SETTINGS_LIMITS,
  buildUrlTree,
  getUrlTreeSlice,
  isValidBatchIntervalRange,
  isValidBatchIntervalSeconds
} from '@loci/shared'
import type { ServerAdminAuditMethod } from '@loci/shared'
import { AdminAuth, readBearerToken } from './auth.js'
import { createAdminEventsHandler } from './admin-event-route.js'
import { ConflictError, NotFoundError, ServerDatabase } from './database.js'
import { SyncService } from './sync-service.js'
import type { LibraryInput } from './types.js'

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
})

const librarySchema = z.object({
  name: z
    .string()
    .trim()
    .min(DOCUMENT_SOURCE_LIMITS.nameLength.min)
    .max(DOCUMENT_SOURCE_LIMITS.nameLength.max),
  url: z.string().url(),
  scopePath: z.string().default(DOCUMENT_SOURCE_DEFAULTS.scopePath),
  pageLimit: z
    .number()
    .int()
    .min(DOCUMENT_SOURCE_LIMITS.pageLimit.min)
    .max(DOCUMENT_SOURCE_LIMITS.pageLimit.max),
  schedule: z.string().nullable()
})

const syncBatchSchema = z.object({
  libraryIds: z.array(z.string().min(1)).min(1).max(100)
})

const prioritySchema = z.object({ priority: z.number().int().min(-100).max(100) })
const hostnameSchema = z.object({ hostname: z.string().trim().min(1).optional() })
const hostnamePolicySchema = z.object({
  hostname: z.string().trim().min(1).optional(),
  httpConcurrency: z
    .number()
    .int()
    .min(APP_SETTINGS_LIMITS.concurrency.min)
    .max(APP_SETTINGS_LIMITS.concurrency.max)
    .nullable(),
  browserConcurrency: z
    .number()
    .int()
    .min(APP_SETTINGS_LIMITS.concurrency.min)
    .max(APP_SETTINGS_LIMITS.concurrency.max)
    .nullable(),
  batchIntervalMinSeconds: z
    .number()
    .refine(isValidBatchIntervalSeconds, '批次间隔超出允许范围')
    .nullable(),
  batchIntervalMaxSeconds: z
    .number()
    .refine(isValidBatchIntervalSeconds, '批次间隔超出允许范围')
    .nullable()
})

const serverCrawlSettingsSchema = z
  .object({
    maxConcurrentJobs: z
      .number()
      .int()
      .min(SERVER_CRAWL_SETTINGS_LIMITS.maxConcurrentJobs.min)
      .max(SERVER_CRAWL_SETTINGS_LIMITS.maxConcurrentJobs.max),
    httpConcurrency: z
      .number()
      .int()
      .min(SERVER_CRAWL_SETTINGS_LIMITS.concurrency.min)
      .max(SERVER_CRAWL_SETTINGS_LIMITS.concurrency.max),
    browserConcurrency: z
      .number()
      .int()
      .min(SERVER_CRAWL_SETTINGS_LIMITS.concurrency.min)
      .max(SERVER_CRAWL_SETTINGS_LIMITS.concurrency.max),
    batchIntervalMinSeconds: z.number().refine(isValidBatchIntervalSeconds),
    batchIntervalMaxSeconds: z.number().refine(isValidBatchIntervalSeconds),
    revision: z.number().int().positive()
  })
  .refine(
    (input) =>
      isValidBatchIntervalRange(input.batchIntervalMinSeconds, input.batchIntervalMaxSeconds),
    { message: '批次间隔最小值不能大于最大值' }
  )

class InputError extends Error {}

interface AppServices {
  database: ServerDatabase
  sync: SyncService
  auth: AdminAuth
}

/** Hono 仅负责 HTTP 边界，抓取、存储和认证由可测试的服务对象承担。 */
export function createApp({ database, sync, auth }: AppServices): Hono {
  const app = new Hono()

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse()
    if (error instanceof InputError) return c.json({ error: error.message }, 400)
    if (error instanceof NotFoundError) return c.json({ error: error.message }, 404)
    if (error instanceof ConflictError) return c.json({ error: error.message }, 409)
    console.error(error)
    return c.json({ error: '服务器内部错误' }, 500)
  })

  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.get('/api/v1/libraries', (c) => c.json({ libraries: database.listPublishedLibraries() }))

  app.get('/api/v1/libraries/:id/tree', (c) => {
    const id = c.req.param('id')
    const library = database.getLibrary(id)
    const files = database.listLibraryFiles(id, 0, 10_000).items
    const parentId = c.req.query('parent_id')
    const depth = queryInteger(c.req.query('depth'), 1, 1, 5)
    const nodes = getUrlTreeSlice(buildUrlTree(files, id), parentId, depth)
    if (!nodes) throw new NotFoundError('目录节点不存在')
    return c.json({ libraryId: id, title: library.name, parentId: parentId ?? null, nodes })
  })

  app.get('/api/v1/libraries/:id/files', (c) => {
    const offset = queryInteger(c.req.query('offset'), 0, 0, 1_000_000)
    const limit = queryInteger(c.req.query('limit'), 100, 1, 500)
    return c.json(database.listLibraryFiles(c.req.param('id'), offset, limit))
  })

  app.get('/api/v1/libraries/:id/files/:fileId', (c) => {
    const file = database.readLibraryFile(
      c.req.param('id'),
      c.req.param('fileId'),
      queryInteger(c.req.query('offset'), 0, 0, 10_000_000),
      queryInteger(c.req.query('max_chars'), 20_000, 1_000, 50_000)
    )
    if (!file) throw new NotFoundError('文档文件不存在')
    return c.json({ file })
  })

  app.get('/api/v1/libraries/:id/snapshot', (c) => {
    const snapshot = database.getSnapshot(c.req.param('id'))
    const etag = `"${snapshot.revision}"`
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304)
    return c.body(snapshot.content, 200, {
      'Content-Type': 'application/vnd.loci.snapshot+json; charset=utf-8',
      'Cache-Control': 'public, no-cache',
      ETag: etag
    })
  })

  app.use('/api/v1/admin/*', async (c, next) => {
    if (c.req.path === '/api/v1/admin/login') return next()
    return bearerAuth({
      verifyToken: (token) => auth.verify(token),
      noAuthenticationHeader: { message: { error: '需要管理员登录' } },
      invalidToken: { message: { error: '管理员会话无效或已过期' } }
    })(c, next)
  })

  app.use('/api/v1/admin/*', async (c, next) => {
    const method = c.req.method.toUpperCase()
    if (c.req.path === '/api/v1/admin/login' || !isAdminAuditMethod(method)) return next()
    await next()
    if (c.res.status >= 400) return
    try {
      database.adminAudit.record({
        actor: auth.username,
        method,
        path: c.req.path,
        statusCode: c.res.status
      })
    } catch (error) {
      // 业务写入已经成功时，审计故障不得把响应改成可重试失败。
      console.error('记录 Server 管理操作失败', error)
    }
  })

  app.post('/api/v1/admin/login', async (c) => {
    const credentials = await parseJson(c, credentialsSchema)
    const token = auth.login(credentials.username, credentials.password)
    if (!token) return c.json({ error: '管理员用户名或密码错误' }, 401)
    return c.json({ token, expiresIn: 86_400 })
  })

  app.post('/api/v1/admin/logout', (c) => {
    const token = readBearerToken(c.req.header('Authorization'))
    if (token) auth.logout(token)
    return c.body(null, 204)
  })

  app.get('/api/v1/admin/events', createAdminEventsHandler(sync, auth))

  app.get('/api/v1/admin/libraries', (c) => c.json({ libraries: database.listLibraries() }))

  app.get('/api/v1/admin/browser', async (c) => c.json({ browser: await sync.getBrowserStatus() }))

  app.post('/api/v1/admin/publish', async (c) => {
    const length = Number(c.req.header('Content-Length') ?? 0)
    if (length > 256 * 1024 * 1024) throw new InputError('发布归档不能超过 256 MB')
    try {
      const payload = await parseLibraryPublishArchive(Buffer.from(await c.req.arrayBuffer()))
      const published = database.publishImportedLibrary(payload)
      return c.json({
        library: published.library,
        revision: published.snapshot.library.revision,
        publishedAt: published.snapshot.library.publishedAt,
        pages: published.snapshot.documents.length,
        contentSize: published.snapshot.documents.reduce(
          (total, document) => total + Buffer.byteLength(document.markdown),
          0
        ),
        reused: published.reused
      })
    } catch (error) {
      if (error instanceof ConflictError || error instanceof NotFoundError) throw error
      throw new InputError(error instanceof Error ? error.message : '发布归档无效')
    }
  })

  app.post('/api/v1/admin/libraries', async (c) => {
    const library = database.createLibrary(await readLibraryInput(c))
    sync.reschedule(library.id)
    return c.json({ library }, 201)
  })

  app.put('/api/v1/admin/libraries/:id', async (c) => {
    const id = c.req.param('id')
    const input = await readLibraryInput(c)
    if (sync.isRunning(id)) throw new ConflictError('同步期间不能修改文档库')
    const library = database.updateLibrary(id, input)
    sync.reschedule(id)
    return c.json({ library })
  })

  app.delete('/api/v1/admin/libraries/:id', (c) => {
    const id = c.req.param('id')
    if (sync.isRunning(id)) throw new ConflictError('同步期间不能删除文档库')
    sync.removeSchedule(id)
    database.deleteLibrary(id)
    return c.body(null, 204)
  })

  app.post('/api/v1/admin/libraries/:id/sync', (c) => {
    const job = sync.start(c.req.param('id'))
    return c.json({ job }, 202)
  })

  app.post('/api/v1/admin/libraries/sync', async (c) => {
    const { libraryIds } = await parseJson(c, syncBatchSchema)
    return c.json({ jobs: sync.startMany(libraryIds) }, 202)
  })

  app.get('/api/v1/admin/jobs', (c) => c.json({ jobs: sync.listJobs() }))

  app.get('/api/v1/admin/audit-logs', (c) => {
    const offset = queryInteger(c.req.query('offset'), 0, 0, 1_000_000)
    const limit = queryInteger(c.req.query('limit'), 50, 1, 200)
    return c.json({ logs: database.adminAudit.list(offset, limit) })
  })

  app.get('/api/v1/admin/crawl-settings', (c) => c.json({ settings: sync.getCrawlSettings() }))

  app.put('/api/v1/admin/crawl-settings', async (c) => {
    const settings = sync.saveCrawlSettings(await parseJson(c, serverCrawlSettingsSchema))
    return c.json({ settings })
  })

  app.get('/api/v1/admin/hostname-policies', (c) =>
    c.json({ policies: database.hostnamePolicies.list() })
  )

  app.put('/api/v1/admin/hostname-policies/:hostname', async (c) => {
    const input = await parseJson(c, hostnamePolicySchema)
    return c.json({
      policy: database.hostnamePolicies.save({ ...input, hostname: c.req.param('hostname') })
    })
  })

  app.delete('/api/v1/admin/hostname-policies/:hostname', (c) => {
    database.hostnamePolicies.delete(c.req.param('hostname'))
    return c.body(null, 204)
  })

  app.get('/api/v1/admin/jobs/:id', (c) => {
    const job = sync.getJob(c.req.param('id'))
    if (!job) throw new NotFoundError('同步任务不存在')
    return c.json({ job })
  })

  app.post('/api/v1/admin/jobs/pause-all', async (c) => {
    const { hostname } = await parseJson(c, hostnameSchema)
    return c.json({ changed: sync.controlMany('pause', hostname?.toLowerCase()) })
  })

  app.post('/api/v1/admin/jobs/resume-all', async (c) => {
    const { hostname } = await parseJson(c, hostnameSchema)
    return c.json({ changed: sync.controlMany('resume', hostname?.toLowerCase()) })
  })

  app.post('/api/v1/admin/jobs/:id/:action', (c) => {
    const action = c.req.param('action')
    const job =
      action === 'cancel'
        ? sync.cancel(c.req.param('id'))
        : action === 'pause'
          ? sync.pause(c.req.param('id'))
          : action === 'resume'
            ? sync.resume(c.req.param('id'))
            : action === 'stop'
              ? sync.stop(c.req.param('id'))
              : undefined
    if (!job) throw new NotFoundError('同步任务不存在')
    return c.json({ job })
  })

  app.put('/api/v1/admin/jobs/:id/priority', async (c) => {
    const { priority } = await parseJson(c, prioritySchema)
    const job = sync.setPriority(c.req.param('id'), priority)
    if (!job) throw new NotFoundError('同步任务不存在')
    return c.json({ job })
  })

  return app
}

function isAdminAuditMethod(method: string): method is ServerAdminAuditMethod {
  return method === 'POST' || method === 'PUT' || method === 'DELETE'
}

async function readLibraryInput(c: Parameters<typeof parseJson>[0]): Promise<LibraryInput> {
  const input = await parseJson(c, librarySchema)
  try {
    return {
      ...input,
      scopePath: normalizeScopePath(input.scopePath),
      schedule: normalizeCronSchedule(input.schedule)
    }
  } catch (error) {
    throw new InputError(error instanceof Error ? error.message : '抓取计划无效')
  }
}

async function parseJson<T extends z.ZodType>(
  c: { req: { json: () => Promise<unknown> } },
  schema: T
): Promise<z.infer<T>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new InputError('请求正文必须是 JSON')
  }
  const result = schema.safeParse(body)
  if (!result.success) throw new InputError(result.error.issues[0]?.message ?? '请求参数无效')
  return result.data
}

function queryInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new InputError(`查询参数必须是 ${minimum} 到 ${maximum} 之间的整数`)
  }
  return parsed
}
