import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  AppSettings,
  CreateSourceInput,
  CreateSourceResult,
  SaveHostnameCrawlPolicyInput,
  UpdateSourceInput
} from '@loci/shared'
import type { LocalRuntime } from './local-runtime.js'
import { handleLocalAdmin } from './local-http-admin.js'
import { handleAgentIntegrations } from './local-http-agent.js'
import { handleOperationLogs } from './local-http-logs.js'
import { handleLibraryBrowser } from './local-http-library-browser.js'
import { handleDataTransfer } from './local-http-data-transfer.js'
import { json, mutationJson, readJson, safeClientError } from './local-http-response.js'

export interface LocalApiOptions {
  runMaintenance?: <T>(action: () => T | Promise<T>) => Promise<T>
  startJobWorker?: () => Promise<void>
  ensurePersistentBackground?: () => Promise<void>
}

export async function handleLocalApi(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: LocalApiOptions
): Promise<void> {
  if (await handleLocalAdmin(runtime, request, response, url)) return
  if (await handleAgentIntegrations(runtime, request, response, url)) return
  if (handleOperationLogs(runtime, request, response, url)) return
  if (handleLibraryBrowser(runtime, request, response, url)) return
  if (handleResourceRevisions(runtime, request, response, url)) return
  if (await handleSources(runtime, request, response, url, options)) return
  if (await handleDocumentsAndJobs(runtime, request, response, url, options)) return
  if (await handleSettings(runtime, request, response, url)) return
  if (await handleCloud(runtime, request, response, url, options)) return
  if (await handleDataTransfer(runtime, request, response, url, options)) return
  response.writeHead(404).end()
}

function handleResourceRevisions(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): boolean {
  if (request.method !== 'GET' || url.pathname !== '/api/revisions') return false
  json(response, 200, runtime.database.getResourceRevisions())
  return true
}

async function handleSources(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: LocalApiOptions
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/api/sources') {
    json(response, 200, runtime.database.listSources())
    return true
  }
  if (request.method === 'POST' && url.pathname === '/api/sources') {
    await mutationJson(response, 201, async () => {
      const input = (await readJson(request)) as CreateSourceInput
      if (input.schedule) await options.ensurePersistentBackground?.()
      const sourceIds = new Set(runtime.database.listSources().map((item) => item.id))
      const source = runtime.createSource(input)
      const sync =
        url.searchParams.get('sync') === 'true'
          ? runtime.database.enqueueSourceSync(source.id, 'ui', undefined, {
              deleteSourceOnCancel: !sourceIds.has(source.id)
            })
          : null
      let workerError: string | null = null
      if (sync) {
        try {
          await options.startJobWorker?.()
        } catch (error) {
          workerError = safeClientError(error)
        }
      }
      return { source, sync, workerError } satisfies CreateSourceResult
    })
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
        if (input.schedule) await options.ensurePersistentBackground?.()
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
  options: LocalApiOptions
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/api/documents') {
    const query = url.searchParams.get('query')?.trim()
    const sourceId = url.searchParams.get('source')?.trim()
    const documents = query
      ? runtime.database.searchDocumentSummaries(query, sourceId)
      : runtime.database.listDocumentSummaries(sourceId)
    json(response, 200, documents)
    return true
  }
  const documentMatch = /^\/api\/documents\/([^/]+)$/u.exec(url.pathname)
  if (request.method === 'GET' && documentMatch) {
    const document = runtime.database.getDocument(decodeURIComponent(documentMatch[1]!))
    if (!document) json(response, 404, { error: '文档不存在' })
    else json(response, 200, document)
    return true
  }
  if (request.method === 'GET' && url.pathname === '/api/jobs') {
    json(response, 200, runtime.database.listLocalJobs())
    return true
  }
  if (request.method === 'POST' && url.pathname === '/api/jobs/source-sync') {
    const body = await readJson(request)
    if (!isStringField(body, 'sourceId')) json(response, 400, { error: '缺少文档源 ID' })
    else {
      const result = runtime.database.enqueueSourceSync(body.sourceId, 'ui')
      await options.startJobWorker?.()
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
  const controlMatch = /^\/api\/jobs\/([^/]+)\/(pause|resume|stop)$/u.exec(url.pathname)
  if (request.method === 'POST' && controlMatch) {
    const id = decodeURIComponent(controlMatch[1]!)
    const action = controlMatch[2]
    const job =
      action === 'pause'
        ? runtime.database.requestLocalJobPause(id)
        : action === 'resume'
          ? runtime.database.resumeLocalJob(id)
          : runtime.database.requestLocalJobStop(id)
    if (!job) json(response, 404, { error: '任务不存在' })
    else {
      if (action === 'resume') await options.startJobWorker?.()
      json(response, 200, job)
    }
    return true
  }
  const priorityMatch = /^\/api\/jobs\/([^/]+)\/priority$/u.exec(url.pathname)
  if (request.method === 'PUT' && priorityMatch) {
    const body = await readJson(request)
    if (!isNumberField(body, 'priority')) json(response, 400, { error: '缺少任务优先级' })
    else {
      const job = runtime.database.setLocalJobPriority(
        decodeURIComponent(priorityMatch[1]!),
        body.priority
      )
      if (!job) json(response, 404, { error: '任务不存在' })
      else json(response, 200, job)
    }
    return true
  }
  if (request.method === 'POST' && /^\/api\/jobs\/(pause-all|resume-all)$/u.test(url.pathname)) {
    const body = await readJson(request)
    const hostname = isStringField(body, 'hostname')
      ? body.hostname.trim().toLowerCase()
      : undefined
    const changed = url.pathname.endsWith('/pause-all')
      ? runtime.database.pauseLocalJobs(hostname || undefined)
      : runtime.database.resumeLocalJobs(hostname || undefined)
    if (url.pathname.endsWith('/resume-all')) await options.startJobWorker?.()
    json(response, 200, { changed })
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
    await mutationJson(response, 200, async () => {
      const previous = runtime.database.getSettings()
      const saved = runtime.database.saveSettings((await readJson(request)) as AppSettings)
      if (saved.serverUrl !== previous.serverUrl) {
        await runtime.admin.logout().catch(() => undefined)
      }
      return saved
    })
    return true
  }
  if (request.method === 'GET' && url.pathname === '/api/settings/hostname-policies') {
    json(response, 200, runtime.database.listHostnameCrawlPolicies())
    return true
  }
  const policyMatch = /^\/api\/settings\/hostname-policies\/([^/]+)$/u.exec(url.pathname)
  if (request.method === 'PUT' && policyMatch) {
    await mutationJson(response, 200, async () => {
      const hostname = decodeURIComponent(policyMatch[1]!)
      const input = (await readJson(request)) as SaveHostnameCrawlPolicyInput
      return runtime.database.saveHostnameCrawlPolicy({ ...input, hostname })
    })
    return true
  }
  if (request.method === 'DELETE' && policyMatch) {
    json(response, 200, {
      deleted: runtime.database.deleteHostnameCrawlPolicy(decodeURIComponent(policyMatch[1]!))
    })
    return true
  }
  return false
}

async function handleCloud(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: LocalApiOptions
): Promise<boolean> {
  const serverUrl = runtime.database.getSettings().serverUrl
  if (request.method === 'GET' && url.pathname === '/api/cloud/catalog') {
    await mutationJson(response, 200, () => runtime.cloud.listCatalog(serverUrl))
    return true
  }
  const cloudTree = /^\/api\/cloud\/libraries\/([^/]+)\/tree$/u.exec(url.pathname)
  if (request.method === 'GET' && cloudTree) {
    await mutationJson(response, 200, () =>
      runtime.cloud.getLibraryTree(
        serverUrl,
        decodeURIComponent(cloudTree[1]!),
        url.searchParams.get('parent_id') ?? undefined,
        Number(url.searchParams.get('depth') ?? 1)
      )
    )
    return true
  }
  const cloudFile = /^\/api\/cloud\/libraries\/([^/]+)\/files\/([^/]+)$/u.exec(url.pathname)
  if (request.method === 'GET' && cloudFile) {
    await mutationJson(response, 200, () =>
      runtime.cloud.readLibraryFile(
        serverUrl,
        decodeURIComponent(cloudFile[1]!),
        decodeURIComponent(cloudFile[2]!),
        Number(url.searchParams.get('offset') ?? 0),
        Number(url.searchParams.get('max_chars') ?? 20_000)
      )
    )
    return true
  }
  const pull = /^\/api\/cloud\/libraries\/([^/]+)\/pull$/u.exec(url.pathname)
  if (request.method === 'POST' && pull) {
    await mutationJson(response, 200, async () => {
      const body = await readJson(request)
      const enabled = readBooleanField(body, 'autoSync', false)
      if (enabled) await options.ensurePersistentBackground?.()
      runtime.assertWritable()
      return runtime.cloud.importLibrary(serverUrl, decodeURIComponent(pull[1]!), enabled)
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
      if (body.enabled) await options.ensurePersistentBackground?.()
      runtime.assertWritable()
      runtime.cloud.setAutoSync(decodeURIComponent(autoSync[1]!), serverUrl, body.enabled)
      return { enabled: body.enabled }
    })
    return true
  }
  return false
}

function isStringField(value: unknown, key: string): value is Record<string, string> {
  if (!value || typeof value !== 'object') return false
  return typeof (value as Record<string, unknown>)[key] === 'string'
}

function isBooleanField(value: unknown, key: string): value is Record<string, boolean> {
  if (!value || typeof value !== 'object') return false
  return typeof (value as Record<string, unknown>)[key] === 'boolean'
}

function isNumberField(value: unknown, key: string): value is Record<string, number> {
  if (!value || typeof value !== 'object') return false
  return typeof (value as Record<string, unknown>)[key] === 'number'
}

function readBooleanField(value: unknown, key: string, fallback: boolean): boolean {
  return isBooleanField(value, key) ? value[key]! : fallback
}
