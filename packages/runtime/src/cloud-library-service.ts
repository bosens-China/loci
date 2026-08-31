import { createHash } from 'node:crypto'
import { z } from 'zod'
import { DOCUMENT_SOURCE_LIMITS } from '@loci/core'
import type {
  CloudCatalogItem,
  CloudImportResult,
  LibraryFileRecord,
  UrlTreeNode
} from '@loci/shared'
import { normalizeServerUrl } from '@loci/shared'
import type { CloudSnapshot } from './cloud-library-database.js'
import type { LociDatabase } from './database.js'
import {
  RuntimeLockedError,
  acquireDatabaseWriteRuntimeLock,
  readRuntimeLock,
  type RuntimeLock
} from './runtime-lock.js'

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
        markdown: z.string(),
        relativePath: z.string().nullable().optional()
      })
    )
    .min(1)
    .max(DOCUMENT_SOURCE_LIMITS.pageLimit.max)
})

const treeNodeSchema: z.ZodType<UrlTreeNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    readable: z.boolean(),
    children: z.array(treeNodeSchema).optional()
  })
)
const cloudTreeSchema = z.object({
  libraryId: z.string(),
  title: z.string(),
  parentId: z.string().nullable(),
  nodes: z.array(treeNodeSchema)
})
const cloudFileSchema = z.object({
  file: z.object({
    id: z.string(),
    libraryId: z.string(),
    title: z.string(),
    url: z.string(),
    path: z.string(),
    language: z.string(),
    updatedAt: z.string(),
    content: z.string(),
    contentBytes: z.number().int().nonnegative().optional(),
    offset: z.number().int(),
    nextOffset: z.number().int().optional(),
    totalChars: z.number().int(),
    truncated: z.boolean()
  })
})

export class CloudLibraryService {
  private readonly updating = new Map<string, Promise<CloudImportResult>>()

  constructor(
    private readonly database: LociDatabase,
    private readonly fetcher: typeof fetch = fetch,
    private readonly dataDir?: string
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

  async getLibraryTree(
    serverUrl: string,
    libraryId: string,
    parentId?: string,
    depth = 1
  ): Promise<{ libraryId: string; title: string; parentId: string | null; nodes: UrlTreeNode[] }> {
    const normalized = normalizeServerUrl(serverUrl)
    const query = new URLSearchParams({ depth: String(depth) })
    if (parentId) query.set('parent_id', parentId)
    return cloudTreeSchema.parse(
      await this.request(
        normalized,
        `/api/v1/libraries/${encodeURIComponent(libraryId)}/tree?${query}`
      )
    )
  }

  async readLibraryFile(
    serverUrl: string,
    libraryId: string,
    fileId: string,
    offset = 0,
    maxChars = 20_000
  ): Promise<LibraryFileRecord> {
    const normalized = normalizeServerUrl(serverUrl)
    const query = new URLSearchParams({ offset: String(offset), max_chars: String(maxChars) })
    return cloudFileSchema.parse(
      await this.request(
        normalized,
        `/api/v1/libraries/${encodeURIComponent(libraryId)}/files/${encodeURIComponent(fileId)}?${query}`
      )
    ).file
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
    const normalized = normalizeServerUrl(currentServerUrl)
    const initial = this.database.getCloudSource(sourceId)
    const lock = this.dataDir
      ? acquireDatabaseWriteRuntimeLock(
          this.dataDir,
          cloudLibraryLockKey(normalized, initial.libraryId),
          '云文档设置'
        )
      : undefined
    try {
      const source = this.database.getCloudSource(sourceId)
      if (source.serverUrl !== normalized) {
        throw new Error('这个云文档来自其他后端，不能启用自动同步')
      }
      this.database.setCloudAutoSync(sourceId, enabled)
    } finally {
      lock?.release()
    }
  }

  async syncEligible(serverUrl: string): Promise<void> {
    const normalized = normalizeServerUrl(serverUrl)
    // ponytail: 客户端按库顺序更新；库数量增长到影响耗时后再增加有限并发。
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
    const active = this.updating.get(key)
    if (active) return active
    const task = this.downloadOnce(serverUrl, libraryId, sourceId, revision, autoSync)
    this.updating.set(key, task)
    try {
      return await task
    } finally {
      if (this.updating.get(key) === task) this.updating.delete(key)
    }
  }

  private async downloadOnce(
    serverUrl: string,
    libraryId: string,
    sourceId: string | null,
    revision: string | undefined,
    autoSync: boolean
  ): Promise<CloudImportResult> {
    let lock: RuntimeLock | undefined
    if (this.dataDir) {
      const lockKey = cloudLibraryLockKey(serverUrl, libraryId)
      try {
        lock = acquireDatabaseWriteRuntimeLock(this.dataDir, lockKey, '云文档同步')
      } catch (error) {
        if (!(error instanceof RuntimeLockedError)) throw error
        if (readRuntimeLock(this.dataDir, 'maintenance')) throw error
        await waitForRuntimeLock(this.dataDir, lockKey)
        const current = this.database.findCloudSource(serverUrl, libraryId)
        if (current && current.revision !== revision) return this.result(current.sourceId, true)
        if (sourceId && !current) throw new Error('云文档副本已被删除，请重新拉取')
        return this.downloadOnce(serverUrl, libraryId, sourceId, revision, autoSync)
      }
    }
    try {
      const snapshot = await this.fetchSnapshot(serverUrl, libraryId, revision)
      if (!snapshot) return this.result(sourceId, false)
      if (snapshot.library.id !== libraryId) throw new Error('服务器返回了错误的文档库快照')
      const saved = this.database.replaceCloudSnapshot(serverUrl, snapshot, autoSync)
      return this.result(saved.sourceId, saved.updated)
    } finally {
      lock?.release()
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

export function cloudLibraryLockKey(serverUrl: string, libraryId: string): string {
  return `cloud-${createHash('sha256').update(`${serverUrl}\n${libraryId}`).digest('hex')}`
}

async function waitForRuntimeLock(dataDir: string, key: string): Promise<void> {
  while (readRuntimeLock(dataDir, key)) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function requestError(status: number, body: unknown): Error {
  const parsed = z.object({ error: z.string() }).safeParse(body)
  return new Error(parsed.success ? parsed.data.error : `云端请求失败（${status}）`)
}
