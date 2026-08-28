import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  CloudAdminLoginInput,
  CloudLibraryInput,
  SaveServerCrawlSettingsInput
} from '@loci/shared'
import type { LocalRuntime } from './local-runtime.js'
import { json, mutationJson, readJson } from './local-http-response.js'

/** 将浏览器 Admin 操作代理到 Runtime，远程 Bearer Token 始终留在本机内存。 */
export async function handleLocalAdmin(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/api/admin/session') {
    json(response, 200, runtime.admin.getSession())
    return true
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/login') {
    await mutationJson(response, 200, async () =>
      runtime.admin.login(
        runtime.database.getSettings().serverUrl,
        (await readJson(request)) as CloudAdminLoginInput
      )
    )
    return true
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/logout') {
    await mutationJson(response, 200, async () => {
      // 远端注销失败时 Runtime 也已清空令牌，本地界面应立即退出。
      await runtime.admin.logout().catch(() => undefined)
      return { authenticated: false }
    })
    return true
  }
  const publish = /^\/api\/admin\/publish\/([^/]+)$/u.exec(url.pathname)
  if (request.method === 'POST' && publish) {
    await mutationJson(response, 200, async () => {
      const body = (await readJson(request)) as {
        mode?: unknown
        targetLibraryId?: unknown
      }
      const mode = body.mode === 'replace' ? 'replace' : body.mode === 'create' ? 'create' : null
      if (!mode) throw new Error('发布模式无效')
      const target = typeof body.targetLibraryId === 'string' ? body.targetLibraryId : undefined
      if (mode === 'replace' && !target) throw new Error('覆盖发布必须指定目标文档库')
      const archive = await runtime.database.exportLibraryPublishArchive(
        decodeURIComponent(publish[1]!),
        mode,
        target
      )
      return runtime.admin.publishLibrary(archive)
    })
    return true
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/libraries') {
    await mutationJson(response, 200, () => runtime.admin.listLibraries())
    return true
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/browser') {
    await mutationJson(response, 200, () => runtime.admin.getBrowserStatus())
    return true
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/libraries') {
    await mutationJson(response, 201, async () =>
      runtime.admin.createLibrary((await readJson(request)) as CloudLibraryInput)
    )
    return true
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/libraries/sync') {
    await mutationJson(response, 202, async () => {
      const body = (await readJson(request)) as { libraryIds?: unknown }
      if (!Array.isArray(body?.libraryIds) || !body.libraryIds.every(isString)) {
        throw new Error('请选择要同步的文档库')
      }
      return runtime.admin.syncLibraries(body.libraryIds)
    })
    return true
  }
  const library = /^\/api\/admin\/libraries\/([^/]+)$/u.exec(url.pathname)
  if (request.method === 'PUT' && library) {
    await mutationJson(response, 200, async () =>
      runtime.admin.updateLibrary(
        decodeURIComponent(library[1]!),
        (await readJson(request)) as CloudLibraryInput
      )
    )
    return true
  }
  if (request.method === 'DELETE' && library) {
    await mutationJson(response, 200, async () => {
      await runtime.admin.deleteLibrary(decodeURIComponent(library[1]!))
      return { deleted: true }
    })
    return true
  }
  const sync = /^\/api\/admin\/libraries\/([^/]+)\/sync$/u.exec(url.pathname)
  if (request.method === 'POST' && sync) {
    await mutationJson(response, 202, () => runtime.admin.syncLibrary(decodeURIComponent(sync[1]!)))
    return true
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/jobs') {
    await mutationJson(response, 200, () => runtime.admin.listSyncJobs())
    return true
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/audit-logs') {
    const offset = parseInteger(url.searchParams.get('offset'), 0, 0, 1_000_000)
    const limit = parseInteger(url.searchParams.get('limit'), 50, 1, 200)
    await mutationJson(response, 200, () => runtime.admin.listAuditLogs(offset, limit))
    return true
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/crawl-settings') {
    await mutationJson(response, 200, () => runtime.admin.getCrawlSettings())
    return true
  }
  if (request.method === 'PUT' && url.pathname === '/api/admin/crawl-settings') {
    await mutationJson(response, 200, async () =>
      runtime.admin.saveCrawlSettings((await readJson(request)) as SaveServerCrawlSettingsInput)
    )
    return true
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/hostname-policies') {
    await mutationJson(response, 200, () => runtime.admin.listHostnamePolicies())
    return true
  }
  const hostnamePolicy = /^\/api\/admin\/hostname-policies\/([^/]+)$/u.exec(url.pathname)
  if (request.method === 'PUT' && hostnamePolicy) {
    await mutationJson(response, 200, async () =>
      runtime.admin.saveHostnamePolicy({
        ...((await readJson(request)) as Parameters<typeof runtime.admin.saveHostnamePolicy>[0]),
        hostname: decodeURIComponent(hostnamePolicy[1]!)
      })
    )
    return true
  }
  if (request.method === 'DELETE' && hostnamePolicy) {
    await mutationJson(response, 200, async () => {
      await runtime.admin.deleteHostnamePolicy(decodeURIComponent(hostnamePolicy[1]!))
      return { deleted: true }
    })
    return true
  }
  const bulk = /^\/api\/admin\/jobs\/(pause-all|resume-all)$/u.exec(url.pathname)
  if (request.method === 'POST' && bulk) {
    await mutationJson(response, 200, async () => {
      const body = (await readJson(request)) as { hostname?: unknown }
      const hostname = typeof body.hostname === 'string' ? body.hostname : undefined
      const changed = await runtime.admin.controlSyncJobs(
        bulk[1] as 'pause-all' | 'resume-all',
        hostname
      )
      return { changed }
    })
    return true
  }
  const control = /^\/api\/admin\/jobs\/([^/]+)\/(pause|resume|stop|cancel)$/u.exec(url.pathname)
  if (request.method === 'POST' && control) {
    await mutationJson(response, 200, () =>
      runtime.admin.controlSyncJob(
        decodeURIComponent(control[1]!),
        control[2] as 'pause' | 'resume' | 'stop' | 'cancel'
      )
    )
    return true
  }
  const priority = /^\/api\/admin\/jobs\/([^/]+)\/priority$/u.exec(url.pathname)
  if (request.method === 'PUT' && priority) {
    await mutationJson(response, 200, async () => {
      const body = (await readJson(request)) as { priority?: unknown }
      if (typeof body.priority !== 'number') throw new Error('缺少任务优先级')
      return runtime.admin.setSyncJobPriority(decodeURIComponent(priority[1]!), body.priority)
    })
    return true
  }
  return false
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function parseInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}
