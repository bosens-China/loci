import { z } from 'zod'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/core'
import type {
  CloudAdminLoginInput,
  CloudAdminSession,
  CloudLibrary,
  CloudLibraryInput,
  CloudLibraryPublishResult,
  CloudSyncJob,
  HostnameCrawlPolicy,
  SaveHostnameCrawlPolicyInput,
  SaveServerCrawlSettingsInput,
  ServerAdminAuditLogPage,
  ServerCrawlSettings,
  ServerBrowserStatus
} from '@loci/shared'
import { normalizeServerUrl } from '@loci/shared'
import { streamServerResourceRevisions } from './cloud-admin-event-stream.js'

const loginResponseSchema = z.object({ token: z.string().min(1), expiresIn: z.number().positive() })
const errorResponseSchema = z.object({ error: z.string() })
const librarySchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  hostname: z.string(),
  scopePath: z.string().default(DOCUMENT_SOURCE_DEFAULTS.scopePath),
  pageLimit: z.number(),
  schedule: z.string().nullable(),
  pages: z.number(),
  lastCrawledAt: z.string().nullable(),
  lastError: z.string().nullable(),
  revision: z.string().nullable(),
  publishedAt: z.string().nullable()
})
const syncJobSchema = z.object({
  id: z.string(),
  libraryId: z.string(),
  hostname: z.string(),
  status: z.enum([
    'queued',
    'running',
    'canceling',
    'canceled',
    'completed',
    'completed_with_errors',
    'failed'
  ]),
  priority: z.number().int(),
  paused: z.boolean(),
  pauseRequested: z.boolean(),
  stopRequested: z.boolean(),
  partial: z.boolean(),
  contentBytes: z.number().int().nonnegative(),
  remainingCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable(),
  progress: z
    .object({
      queued: z.number(),
      processed: z.number(),
      succeeded: z.number(),
      failed: z.number(),
      limitReached: z.boolean()
    })
    .nullable(),
  failures: z.array(z.unknown()),
  error: z.string().nullable()
})
const hostnamePolicySchema = z.object({
  hostname: z.string(),
  httpConcurrency: z.number().int().nullable(),
  browserConcurrency: z.number().int().nullable(),
  batchIntervalMinSeconds: z.number().int().nullable(),
  batchIntervalMaxSeconds: z.number().int().nullable(),
  updatedAt: z.string()
})
const publishResultSchema = z.object({
  library: librarySchema,
  revision: z.string(),
  publishedAt: z.string(),
  pages: z.number().int().nonnegative(),
  contentSize: z.number().int().nonnegative(),
  reused: z.boolean()
})
const serverBrowserStatusSchema = z.object({
  provider: z.enum(['disabled', 'local', 'browserless']),
  available: z.boolean(),
  chromiumVersion: z.string().nullable(),
  playwrightVersion: z.string(),
  endpoint: z.string().nullable(),
  checkedAt: z.string(),
  error: z.string().nullable()
})
const serverCrawlSettingsSchema = z.object({
  maxConcurrentJobs: z.number().int(),
  httpConcurrency: z.number().int(),
  browserConcurrency: z.number().int(),
  batchIntervalMinSeconds: z.number().int(),
  batchIntervalMaxSeconds: z.number().int(),
  revision: z.number().int().positive(),
  updatedAt: z.string()
})
const serverAdminAuditLogSchema = z.object({
  id: z.string(),
  actor: z.string(),
  method: z.enum(['POST', 'PUT', 'DELETE']),
  path: z.string(),
  statusCode: z.number().int(),
  createdAt: z.string()
})
const serverAdminAuditLogPageSchema = z.object({
  items: z.array(serverAdminAuditLogSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive()
})
interface PrivateSession extends CloudAdminSession {
  token: string
}
export interface CloudAdminMutation {
  method: string
  path: string
}
/** 云端令牌只保存在 Runtime 内存中，CLI 与 Web 只能读取脱敏会话。 */
export class CloudAdminClient {
  private session: PrivateSession | null = null

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly onMutation?: (mutation: CloudAdminMutation) => void
  ) {}

  async login(serverUrlInput: string, input: CloudAdminLoginInput): Promise<CloudAdminSession> {
    const serverUrl = normalizeServerUrl(serverUrlInput)
    const payload = loginResponseSchema.parse(
      await this.request(serverUrl, '/api/v1/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username: input.username, password: input.password })
      })
    )
    this.session = {
      serverUrl,
      username: input.username,
      expiresAt: new Date(Date.now() + payload.expiresIn * 1000).toISOString(),
      token: payload.token
    }
    return this.publicSession()
  }

  async logout(): Promise<void> {
    const current = this.validSession()
    try {
      if (current)
        await this.request(current.serverUrl, '/api/v1/admin/logout', { method: 'POST' }, current)
    } finally {
      this.session = null
    }
  }

  getSession(): CloudAdminSession | null {
    return this.validSession() ? this.publicSession() : null
  }

  async listLibraries(): Promise<CloudLibrary[]> {
    const result = z
      .object({ libraries: z.array(librarySchema) })
      .parse(await this.authRequest('/api/v1/admin/libraries'))
    return result.libraries
  }

  async getBrowserStatus(): Promise<ServerBrowserStatus> {
    const result = z
      .object({ browser: serverBrowserStatusSchema })
      .parse(await this.authRequest('/api/v1/admin/browser'))
    return result.browser
  }

  async createLibrary(input: CloudLibraryInput): Promise<CloudLibrary> {
    const result = z.object({ library: librarySchema }).parse(
      await this.authRequest('/api/v1/admin/libraries', {
        method: 'POST',
        body: JSON.stringify(input)
      })
    )
    return result.library
  }

  async updateLibrary(id: string, input: CloudLibraryInput): Promise<CloudLibrary> {
    const result = z.object({ library: librarySchema }).parse(
      await this.authRequest(`/api/v1/admin/libraries/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(input)
      })
    )
    return result.library
  }

  async deleteLibrary(id: string): Promise<void> {
    await this.authRequest(`/api/v1/admin/libraries/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
  }

  async syncLibrary(id: string): Promise<CloudSyncJob> {
    const result = z.object({ job: syncJobSchema }).parse(
      await this.authRequest(`/api/v1/admin/libraries/${encodeURIComponent(id)}/sync`, {
        method: 'POST'
      })
    )
    return result.job as CloudSyncJob
  }

  async syncLibraries(ids: readonly string[]): Promise<CloudSyncJob[]> {
    const result = z.object({ jobs: z.array(syncJobSchema) }).parse(
      await this.authRequest('/api/v1/admin/libraries/sync', {
        method: 'POST',
        body: JSON.stringify({ libraryIds: ids })
      })
    )
    return result.jobs as CloudSyncJob[]
  }

  async listSyncJobs(): Promise<CloudSyncJob[]> {
    const result = z
      .object({ jobs: z.array(syncJobSchema) })
      .parse(await this.authRequest('/api/v1/admin/jobs'))
    return result.jobs as CloudSyncJob[]
  }

  async listAuditLogs(offset = 0, limit = 50): Promise<ServerAdminAuditLogPage> {
    const query = new URLSearchParams({ offset: String(offset), limit: String(limit) })
    const result = z
      .object({ logs: serverAdminAuditLogPageSchema })
      .parse(await this.authRequest(`/api/v1/admin/audit-logs?${query}`))
    return result.logs
  }

  async getSyncJob(id: string): Promise<CloudSyncJob> {
    const result = z
      .object({ job: syncJobSchema })
      .parse(await this.authRequest(`/api/v1/admin/jobs/${encodeURIComponent(id)}`))
    return result.job as CloudSyncJob
  }

  async cancelSyncJob(id: string): Promise<CloudSyncJob> {
    return this.controlSyncJob(id, 'cancel')
  }

  async controlSyncJob(
    id: string,
    action: 'pause' | 'resume' | 'stop' | 'cancel'
  ): Promise<CloudSyncJob> {
    const result = z.object({ job: syncJobSchema }).parse(
      await this.authRequest(`/api/v1/admin/jobs/${encodeURIComponent(id)}/${action}`, {
        method: 'POST'
      })
    )
    return result.job as CloudSyncJob
  }

  async setSyncJobPriority(id: string, priority: number): Promise<CloudSyncJob> {
    const result = z.object({ job: syncJobSchema }).parse(
      await this.authRequest(`/api/v1/admin/jobs/${encodeURIComponent(id)}/priority`, {
        method: 'PUT',
        body: JSON.stringify({ priority })
      })
    )
    return result.job as CloudSyncJob
  }

  async controlSyncJobs(action: 'pause-all' | 'resume-all', hostname?: string): Promise<number> {
    const result = z.object({ changed: z.number().int().nonnegative() }).parse(
      await this.authRequest(`/api/v1/admin/jobs/${action}`, {
        method: 'POST',
        body: JSON.stringify(hostname ? { hostname } : {})
      })
    )
    return result.changed
  }

  async listHostnamePolicies(): Promise<HostnameCrawlPolicy[]> {
    const result = z
      .object({ policies: z.array(hostnamePolicySchema) })
      .parse(await this.authRequest('/api/v1/admin/hostname-policies'))
    return result.policies
  }

  async getCrawlSettings(): Promise<ServerCrawlSettings> {
    const result = z
      .object({ settings: serverCrawlSettingsSchema })
      .parse(await this.authRequest('/api/v1/admin/crawl-settings'))
    return result.settings
  }

  async saveCrawlSettings(input: SaveServerCrawlSettingsInput): Promise<ServerCrawlSettings> {
    const result = z.object({ settings: serverCrawlSettingsSchema }).parse(
      await this.authRequest('/api/v1/admin/crawl-settings', {
        method: 'PUT',
        body: JSON.stringify(input)
      })
    )
    return result.settings
  }

  async saveHostnamePolicy(input: SaveHostnameCrawlPolicyInput): Promise<HostnameCrawlPolicy> {
    const result = z
      .object({ policy: hostnamePolicySchema })
      .parse(
        await this.authRequest(
          `/api/v1/admin/hostname-policies/${encodeURIComponent(input.hostname)}`,
          { method: 'PUT', body: JSON.stringify(input) }
        )
      )
    return result.policy
  }

  async deleteHostnamePolicy(hostname: string): Promise<void> {
    await this.authRequest(`/api/v1/admin/hostname-policies/${encodeURIComponent(hostname)}`, {
      method: 'DELETE'
    })
  }

  async publishLibrary(archive: Buffer): Promise<CloudLibraryPublishResult> {
    return publishResultSchema.parse(
      await this.authRequest('/api/v1/admin/publish', {
        method: 'POST',
        body: new Uint8Array(archive),
        headers: { 'Content-Type': 'application/zip' },
        signal: AbortSignal.timeout(120_000)
      })
    )
  }

  /** 只在 Runtime 内存中持有 Bearer Token，向本机 SSE 代理提供 Server revision 流。 */
  async streamResourceRevisions(
    signal: AbortSignal,
    onRevisions: Parameters<typeof streamServerResourceRevisions>[3]
  ): Promise<void> {
    const session = this.validSession()
    if (!session) return
    const result = await streamServerResourceRevisions(this.fetcher, session, signal, onRevisions)
    if (result === 'unauthorized') this.session = null
  }

  private async authRequest(path: string, init: RequestInit = {}): Promise<unknown> {
    const session = this.validSession()
    if (!session) throw new Error('请先登录超级管理员账号')
    return this.request(session.serverUrl, path, init, session)
  }

  private async request(
    serverUrl: string,
    path: string,
    init: RequestInit,
    session?: PrivateSession
  ): Promise<unknown> {
    let response: Response
    try {
      const headers = new Headers(init.headers)
      if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      if (session) headers.set('Authorization', `Bearer ${session.token}`)
      response = await this.fetcher(`${serverUrl}${path}`, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(15_000),
        headers
      })
    } catch {
      throw new Error('无法连接云端服务器，请检查地址和网络')
    }
    const body = response.status === 204 ? null : await response.json().catch(() => null)
    if (response.ok) {
      const method = init.method?.toUpperCase() ?? 'GET'
      if (method !== 'GET') {
        try {
          this.onMutation?.({ method, path })
        } catch {
          // 云端操作已成功时，本地日志故障不能把成功响应改成失败。
        }
      }
      return body
    }
    if (response.status === 401 && session) this.session = null
    const parsed = errorResponseSchema.safeParse(body)
    throw new Error(parsed.success ? parsed.data.error : `服务器请求失败（${response.status}）`)
  }

  private validSession(): PrivateSession | null {
    if (this.session && Date.parse(this.session.expiresAt) > Date.now()) return this.session
    this.session = null
    return null
  }

  private publicSession(): CloudAdminSession {
    const { serverUrl, username, expiresAt } = this.session!
    return { serverUrl, username, expiresAt }
  }
}
