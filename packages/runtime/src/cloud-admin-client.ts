import { z } from 'zod'
import type {
  CloudAdminLoginInput,
  CloudAdminSession,
  CloudLibrary,
  CloudLibraryInput,
  CloudSyncJob
} from '@loci/shared'
import { normalizeServerUrl } from '@loci/shared'

const loginResponseSchema = z.object({ token: z.string().min(1), expiresIn: z.number().positive() })
const errorResponseSchema = z.object({ error: z.string() })
const librarySchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  hostname: z.string(),
  scopePath: z.string().default('/'),
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
  status: z.enum([
    'queued',
    'running',
    'canceling',
    'canceled',
    'completed',
    'completed_with_errors',
    'failed'
  ]),
  createdAt: z.string(),
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

interface PrivateSession extends CloudAdminSession {
  token: string
}

/** 云端令牌只保存在主进程内存中，渲染进程只能读取脱敏会话。 */
export class CloudAdminClient {
  private session: PrivateSession | null = null

  constructor(private readonly fetcher: typeof fetch = fetch) {}

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

  async getSyncJob(id: string): Promise<CloudSyncJob> {
    const result = z
      .object({ job: syncJobSchema })
      .parse(await this.authRequest(`/api/v1/admin/jobs/${encodeURIComponent(id)}`))
    return result.job as CloudSyncJob
  }

  async cancelSyncJob(id: string): Promise<CloudSyncJob> {
    const result = z.object({ job: syncJobSchema }).parse(
      await this.authRequest(`/api/v1/admin/jobs/${encodeURIComponent(id)}/cancel`, {
        method: 'POST'
      })
    )
    return result.job as CloudSyncJob
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
      response = await this.fetcher(`${serverUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(15_000),
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(session ? { Authorization: `Bearer ${session.token}` } : {})
        }
      })
    } catch {
      throw new Error('无法连接云端服务器，请检查地址和网络')
    }
    const body = response.status === 204 ? null : await response.json().catch(() => null)
    if (response.ok) return body
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
