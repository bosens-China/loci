import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AppSettings, CreateSourceInput, UpdateSourceInput } from '@loci/shared'
import { acquireMaintenanceRuntimeLock } from './runtime-lock.js'
import type { LocalRuntime } from './local-runtime.js'
import { json, mutationJson, readJson, safeClientError } from './local-http-response.js'

const BACKUP_LIMIT_BYTES = 256 * 1024 * 1024

export interface LocalApiOptions {
  runMaintenance?: <T>(action: () => T | Promise<T>) => Promise<T>
}

export async function handleLocalApi(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  events: Set<ServerResponse>,
  options: LocalApiOptions
): Promise<void> {
  if (await handleSources(runtime, request, response, url)) return
  if (await handleDocumentsAndJobs(runtime, request, response, url, events)) return
  if (await handleSettings(runtime, request, response, url)) return
  if (await handleCloud(runtime, request, response, url)) return
  if (await handleDataTransfer(runtime, request, response, url, options)) return
  response.writeHead(404).end()
}

async function handleSources(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/api/sources') {
    json(response, 200, runtime.database.listSources())
    return true
  }
  if (request.method === 'POST' && url.pathname === '/api/sources') {
    await mutationJson(response, 201, async () =>
      runtime.createSource((await readJson(request)) as CreateSourceInput)
    )
    return true
  }
  const match = /^\/api\/sources\/([^/]+)$/u.exec(url.pathname)
  if (request.method === 'PUT' && match) {
    const sourceId = decodeURIComponent(match[1]!)
    const source = runtime.database.listSources().find((item) => item.id === sourceId)
    if (!source) json(response, 404, { error: '文档源不存在' })
    else {
      await mutationJson(response, 200, async () => {
        const input = (await readJson(request)) as UpdateSourceInput
        const updated = runtime.updateSourcePreservingSchedule(source, input)
        return runtime.updateSourceSchedule(updated, input.schedule)
      })
    }
    return true
  }
  if (request.method === 'DELETE' && match) {
    await mutationJson(response, 200, () => {
      runtime.deleteSource(decodeURIComponent(match[1]!))
      return { deleted: true }
    })
    return true
  }
  return false
}

async function handleDocumentsAndJobs(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  events: Set<ServerResponse>
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/api/documents') {
    const query = url.searchParams.get('query')?.trim()
    const sourceId = url.searchParams.get('source')?.trim()
    const documents = query
      ? runtime.database.searchDocuments(query)
      : runtime.database.listDocuments()
    json(
      response,
      200,
      sourceId ? documents.filter((item) => item.sourceId === sourceId) : documents
    )
    return true
  }
  if (request.method === 'GET' && url.pathname === '/api/jobs') {
    json(response, 200, runtime.database.listLocalJobs())
    return true
  }
  if (request.method === 'GET' && url.pathname === '/api/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    })
    response.write(': connected\n\n')
    events.add(response)
    request.once('close', () => events.delete(response))
    return true
  }
  if (request.method === 'POST' && url.pathname === '/api/jobs/source-sync') {
    const body = await readJson(request)
    if (!isStringField(body, 'sourceId')) json(response, 400, { error: '缺少文档源 ID' })
    else {
      const result = runtime.database.enqueueSourceSync(body.sourceId, 'ui')
      json(response, result.reused ? 200 : 202, result)
    }
    return true
  }
  const cancelMatch = /^\/api\/jobs\/([^/]+)\/cancel$/u.exec(url.pathname)
  if (request.method === 'POST' && cancelMatch) {
    const job = runtime.database.requestLocalJobCancellation(decodeURIComponent(cancelMatch[1]!))
    if (!job) json(response, 404, { error: '任务不存在' })
    else json(response, 200, job)
    return true
  }
  return false
}

async function handleSettings(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/api/settings') {
    json(response, 200, runtime.database.getSettings())
    return true
  }
  if (request.method === 'PUT' && url.pathname === '/api/settings') {
    await mutationJson(response, 200, async () =>
      runtime.database.saveSettings((await readJson(request)) as AppSettings)
    )
    return true
  }
  return false
}

async function handleCloud(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  const serverUrl = runtime.database.getSettings().serverUrl
  if (request.method === 'GET' && url.pathname === '/api/cloud/catalog') {
    await mutationJson(response, 200, () => runtime.cloud.listCatalog(serverUrl))
    return true
  }
  const pull = /^\/api\/cloud\/libraries\/([^/]+)\/pull$/u.exec(url.pathname)
  if (request.method === 'POST' && pull) {
    await mutationJson(response, 200, async () => {
      const body = await readJson(request)
      runtime.assertWritable()
      return runtime.cloud.importLibrary(
        serverUrl,
        decodeURIComponent(pull[1]!),
        readBooleanField(body, 'autoSync', true)
      )
    })
    return true
  }
  const update = /^\/api\/cloud\/sources\/([^/]+)\/update$/u.exec(url.pathname)
  if (request.method === 'POST' && update) {
    await mutationJson(response, 200, () => {
      runtime.assertWritable()
      return runtime.cloud.updateLibrary(decodeURIComponent(update[1]!), serverUrl)
    })
    return true
  }
  const autoSync = /^\/api\/cloud\/sources\/([^/]+)\/auto-sync$/u.exec(url.pathname)
  if (request.method === 'PUT' && autoSync) {
    await mutationJson(response, 200, async () => {
      const body = await readJson(request)
      if (!isBooleanField(body, 'enabled')) throw new Error('缺少自动同步状态')
      runtime.assertWritable()
      runtime.cloud.setAutoSync(decodeURIComponent(autoSync[1]!), serverUrl, body.enabled)
      return { enabled: body.enabled }
    })
    return true
  }
  return false
}

async function handleDataTransfer(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: LocalApiOptions
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/api/data/export') {
    try {
      const backup = await runMaintenance(runtime, options, () => runtime.database.exportBackup())
      json(response, 200, backup, {
        'content-disposition': `attachment; filename="loci-backup-${new Date().toISOString().slice(0, 10)}.json"`
      })
    } catch (error) {
      json(response, 409, { error: safeClientError(error) })
    }
    return true
  }
  if (request.method === 'POST' && url.pathname === '/api/data/import') {
    await mutationJson(response, 200, async () => {
      const backup = await readJson(request, BACKUP_LIMIT_BYTES)
      const summary = await runMaintenance(runtime, options, () => {
        const imported = runtime.database.importBackup(backup)
        runtime.resetCrawlStates()
        runtime.database.refreshSourceSchedules()
        return imported
      })
      return { ...summary, restartRequired: true }
    })
    return true
  }
  return false
}

async function runMaintenance<T>(
  runtime: LocalRuntime,
  options: LocalApiOptions,
  action: () => T | Promise<T>
): Promise<T> {
  const run = async (): Promise<T> => {
    const lock = acquireMaintenanceRuntimeLock(runtime.dataDir, 'Web 数据维护')
    try {
      return await action()
    } finally {
      lock.release()
    }
  }
  return options.runMaintenance ? options.runMaintenance(run) : run()
}

function isStringField(value: unknown, key: string): value is Record<string, string> {
  if (!value || typeof value !== 'object') return false
  return typeof (value as Record<string, unknown>)[key] === 'string'
}

function isBooleanField(value: unknown, key: string): value is Record<string, boolean> {
  if (!value || typeof value !== 'object') return false
  return typeof (value as Record<string, unknown>)[key] === 'boolean'
}

function readBooleanField(value: unknown, key: string, fallback: boolean): boolean {
  return isBooleanField(value, key) ? value[key]! : fallback
}
