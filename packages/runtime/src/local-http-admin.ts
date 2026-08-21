import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CloudAdminLoginInput, CloudLibraryInput } from '@loci/shared'
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
  if (request.method === 'GET' && url.pathname === '/api/admin/libraries') {
    await mutationJson(response, 200, () => runtime.admin.listLibraries())
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
  const cancel = /^\/api\/admin\/jobs\/([^/]+)\/cancel$/u.exec(url.pathname)
  if (request.method === 'POST' && cancel) {
    await mutationJson(response, 200, () =>
      runtime.admin.cancelSyncJob(decodeURIComponent(cancel[1]!))
    )
    return true
  }
  return false
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
