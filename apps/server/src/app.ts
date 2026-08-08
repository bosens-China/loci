import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { HTTPException } from 'hono/http-exception'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  DOCUMENT_SOURCE_LIMITS,
  normalizeCronSchedule,
  normalizeScopePath
} from '@loci/core'
import { z } from 'zod'
import { AdminAuth, readBearerToken } from './auth.js'
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

  app.get('/api/v1/admin/libraries', (c) => c.json({ libraries: database.listLibraries() }))

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

  app.get('/api/v1/admin/jobs/:id', (c) => {
    const job = sync.getJob(c.req.param('id'))
    if (!job) throw new NotFoundError('同步任务不存在')
    return c.json({ job })
  })

  app.post('/api/v1/admin/jobs/:id/cancel', (c) => {
    const job = sync.cancel(c.req.param('id'))
    if (!job) throw new NotFoundError('同步任务不存在')
    return c.json({ job })
  })

  return app
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
