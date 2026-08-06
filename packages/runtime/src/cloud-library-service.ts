import { z } from 'zod'
import type { CloudCatalogItem, CloudImportResult } from '@loci/shared'
import { normalizeServerUrl } from '@loci/shared'
import type { CloudSnapshot } from './cloud-library-database.js'
import type { LociDatabase } from './database.js'

const publicLibrarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  revision: z.string().min(1),
  pages: z.number().int().nonnegative(),
  contentSize: z.number().int().nonnegative(),
  lastCrawledAt: z.string().nullable(),
  publishedAt: z.string()
})

const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  library: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url(),
    revision: z.string().min(1),
    publishedAt: z.string()
  }),
  documents: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string(),
        url: z.string().url(),
        language: z.string(),
        markdown: z.string()
      })
    )
    .min(1)
    .max(10_000)
})

export class CloudLibraryService {
  private readonly updating = new Set<string>()

  constructor(
    private readonly database: LociDatabase,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async listCatalog(serverUrl: string): Promise<CloudCatalogItem[]> {
    const normalized = normalizeServerUrl(serverUrl)
    const parsed = z
      .object({ libraries: z.array(publicLibrarySchema) })
      .safeParse(await this.request(normalized, '/api/v1/libraries'))
    if (!parsed.success) throw new Error('云端后端版本不兼容，请更新后端服务')
    const payload = parsed.data
    return payload.libraries
      .filter((library) => library.pages > 0)
      .map((library) => {
        const local = this.database.findCloudSource(normalized, library.id)
        return {
          ...library,
          localSourceId: local?.sourceId ?? null,
          localRevision: local?.revision ?? null,
          autoSync: local?.autoSync ?? false,
          updateAvailable: Boolean(local && local.revision !== library.revision)
        }
      })
  }

  async importLibrary(
    serverUrl: string,
    libraryId: string,
    autoSync: boolean
  ): Promise<CloudImportResult> {
    const normalized = normalizeServerUrl(serverUrl)
    const local = this.database.findCloudSource(normalized, libraryId)
    return this.download(normalized, libraryId, local?.sourceId ?? null, local?.revision, autoSync)
  }

  async updateLibrary(sourceId: string, currentServerUrl: string): Promise<CloudImportResult> {
    const source = this.database.getCloudSource(sourceId)
    const normalized = normalizeServerUrl(currentServerUrl)
    if (source.serverUrl !== normalized) {
      throw new Error('这个云文档来自其他后端，已停止更新')
    }
    return this.download(
      normalized,
      source.libraryId,
      source.sourceId,
      source.revision,
      source.autoSync
    )
  }

  setAutoSync(sourceId: string, currentServerUrl: string, enabled: boolean): void {
    const source = this.database.getCloudSource(sourceId)
    if (source.serverUrl !== normalizeServerUrl(currentServerUrl)) {
      throw new Error('这个云文档来自其他后端，不能启用自动同步')
    }
    this.database.setCloudAutoSync(sourceId, enabled)
  }

  async syncEligible(serverUrl: string): Promise<void> {
    const normalized = normalizeServerUrl(serverUrl)
    // ponytail: 桌面端按库顺序更新；库数量增长到影响耗时后再增加有限并发。
    for (const source of this.database.listCloudSourcesForSync(normalized)) {
      try {
        await this.updateLibrary(source.sourceId, normalized)
      } catch (error) {
        console.error(`自动更新云文档 ${source.libraryId} 失败`, error)
      }
    }
  }

  private async download(
    serverUrl: string,
    libraryId: string,
    sourceId: string | null,
    revision: string | undefined,
    autoSync: boolean
  ): Promise<CloudImportResult> {
    const key = `${serverUrl}\n${libraryId}`
    if (this.updating.has(key)) throw new Error('这个云文档正在更新中')
    this.updating.add(key)
    try {
      const snapshot = await this.fetchSnapshot(serverUrl, libraryId, revision)
      if (!snapshot) return this.result(sourceId, false)
      if (snapshot.library.id !== libraryId) throw new Error('服务器返回了错误的文档库快照')
      const saved = this.database.replaceCloudSnapshot(serverUrl, snapshot, autoSync)
      return this.result(saved.sourceId, saved.updated)
    } finally {
      this.updating.delete(key)
    }
  }

  private async fetchSnapshot(
    serverUrl: string,
    libraryId: string,
    revision?: string
  ): Promise<CloudSnapshot | null> {
    const response = await this.fetchResponse(
      serverUrl,
      `/api/v1/libraries/${encodeURIComponent(libraryId)}/snapshot`,
      revision ? { 'If-None-Match': `"${revision}"` } : undefined
    )
    if (response.status === 304) return null
    const body = await response.json().catch(() => null)
    if (!response.ok) throw requestError(response.status, body)
    const parsed = snapshotSchema.safeParse(body)
    if (z.object({ documents: z.array(z.unknown()).length(0) }).safeParse(body).success) {
      throw new Error('云端快照没有可用文档，未修改本地数据')
    }
    if (!parsed.success) throw new Error('云端后端版本不兼容，请更新后端服务')
    return parsed.data
  }

  private async request(serverUrl: string, path: string): Promise<unknown> {
    const response = await this.fetchResponse(serverUrl, path)
    const body = await response.json().catch(() => null)
    if (!response.ok) throw requestError(response.status, body)
    return body
  }

  private async fetchResponse(
    serverUrl: string,
    path: string,
    headers?: Record<string, string>
  ): Promise<Response> {
    try {
      return await this.fetcher(`${serverUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(60_000)
      })
    } catch {
      throw new Error('无法连接云端后端，请检查地址和网络')
    }
  }

  private result(sourceId: string | null, updated: boolean): CloudImportResult {
    const source = sourceId
      ? this.database.listSources().find((item) => item.id === sourceId)
      : undefined
    if (!source) throw new Error('云文档本地副本不存在')
    return { source, updated, documents: source.pages }
  }
}

function requestError(status: number, body: unknown): Error {
  const parsed = z.object({ error: z.string() }).safeParse(body)
  return new Error(parsed.success ? parsed.data.error : `云端请求失败（${status}）`)
}
