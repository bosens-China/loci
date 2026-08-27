import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { CrawlProgress } from '@loci/core'
import type { CrawlRunState, DocumentSource } from '@loci/shared'
import { CloudAdminClient } from './cloud-admin-client.js'
import { AgentIntegrationService } from './agent-integration.js'
import { CloudLibraryService, cloudLibraryLockKey } from './cloud-library-service.js'
import { CrawlTaskCoordinator } from './crawl-task-coordinator.js'
import { createDatabase, databaseNeedsMigration, type LociDatabase } from './database.js'
import { crawlRunState } from './external-crawl.js'
import { runExplicitPageFetch } from './explicit-page-service.js'
import { LocalBrowserCrawler, type BrowserInstallPrompt } from './browser-crawler.js'
import { resolveLociCacheDir, resolveLociDataDir } from './data-path.js'
import {
  acquireCrawlRuntimeLock,
  acquireDatabaseWriteRuntimeLock,
  acquireMaintenanceRuntimeLock,
  readRuntimeLock
} from './runtime-lock.js'
import { createLocalSourceCrawlRunner } from './local-source-crawl-runner.js'
import { createUrlReviewService } from './url-review-service.js'
import type { LocalRuntime, LocalRuntimeOptions } from './local-runtime-types.js'

export type { LocalRuntime, LocalRuntimeOptions } from './local-runtime-types.js'

/** 所有本机入口共用的应用运行时，入口层只负责交互和 transport。 */
export function createLocalRuntime(options: LocalRuntimeOptions = {}): LocalRuntime {
  const dataDir = options.dataDir ?? resolveLociDataDir()
  const cacheDir = options.cacheDir ?? resolveLociCacheDir()
  const owner = options.owner ?? 'Loci'
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })
  const databasePath = join(dataDir, 'loci.sqlite')
  const migrationLock = databaseNeedsMigration(databasePath)
    ? acquireMaintenanceRuntimeLock(dataDir, `${owner} 数据库迁移`)
    : undefined
  let database: LociDatabase
  try {
    const serverUrl = process.env.LOCI_SERVER_URL?.trim()
    database = createDatabase(databasePath, serverUrl ? { serverUrl, overrideServerUrl: true } : {})
  } finally {
    migrationLock?.release()
  }
  const browser = options.browser ?? new LocalBrowserCrawler(join(cacheDir, 'playwright'))
  const agentIntegration = options.agentIntegration
    ? new AgentIntegrationService({
        ...options.agentIntegration,
        database,
        dataDir
      })
    : undefined
  const states = new Map<string, CrawlRunState>()
  const crawlTasks = new CrawlTaskCoordinator()
  const assertWritable = (): void => {
    const maintenance = readRuntimeLock(dataDir, 'maintenance')
    if (maintenance) throw new Error(`数据库正在由${maintenance.owner}维护，请稍后重试`)
  }
  const mutateSource = <T>(sourceId: string, label: string, action: () => T): T => {
    const lock = acquireCrawlRuntimeLock(dataDir, sourceId, `${owner} ${label}`)
    try {
      return action()
    } finally {
      lock.release()
    }
  }

  const runOnce = createLocalSourceCrawlRunner({ dataDir, owner, database, browser, states })

  const run = (
    sourceId: string,
    onProgress?: (progress: CrawlProgress) => void,
    onBrowserMissing?: BrowserInstallPrompt,
    signal?: AbortSignal,
    localJob?: { id: string; owner: string }
  ): Promise<CrawlProgress> =>
    crawlTasks.run(
      sourceId,
      (reportProgress) => runOnce(sourceId, reportProgress, onBrowserMissing, signal, localJob),
      onProgress
    )

  return {
    dataDir,
    cacheDir,
    database,
    cloud: new CloudLibraryService(database, fetch, dataDir),
    admin: new CloudAdminClient(fetch, ({ method, path }) => {
      database.recordOperationLog({
        category: 'cloud',
        action: `cloud.${method.toLowerCase()}`,
        level: path.endsWith('/cancel') || method === 'DELETE' ? 'warning' : 'info',
        resourceType: 'cloud_api',
        resourceId: path,
        message: `云端管理操作已完成：${method} ${path}`,
        details: { method, path }
      })
    }),
    agentIntegration,
    urlReviews: createUrlReviewService({ database, browser, dataDir, owner }),
    crawlSource: run,
    fetchPages: (sourceId, urls, onBrowserMissing, signal, onProgress) => {
      assertWritable()
      return runExplicitPageFetch(
        { database, browser, dataDir, owner },
        sourceId,
        urls,
        onBrowserMissing,
        signal,
        onProgress
      )
    },
    createSource: (input) => {
      assertWritable()
      return database.createSource(input)
    },
    deleteSource: (sourceId) => {
      const source = requireSource(database, sourceId)
      if (!source.cloud) {
        mutateSource(sourceId, '删除文档源', () => database.deleteSource(sourceId))
        return
      }
      const lock = acquireDatabaseWriteRuntimeLock(
        dataDir,
        cloudLibraryLockKey(source.cloud.serverUrl, source.cloud.libraryId),
        `${owner} 删除云文档副本`
      )
      try {
        database.deleteSource(sourceId)
      } finally {
        lock.release()
      }
    },
    updateSourcePreservingSchedule: (source, input) =>
      mutateSource(source.id, '编辑文档源', () => {
        assertNoActiveUrlReview(database, source.id)
        const current = requireSource(database, source.id)
        return database.updateSource(source.id, { ...input, schedule: current.schedule })
      }),
    updateSourceSchedule: (source, schedule) =>
      mutateSource(source.id, '修改定时计划', () => {
        assertNoActiveUrlReview(database, source.id)
        const current = requireSource(database, source.id)
        return database.updateSource(source.id, {
          name: current.name,
          url: current.url,
          mode: current.mode,
          pageLimit: current.pageLimit,
          scopePath: current.scopePath,
          excludePathPattern: current.excludePathPattern ?? null,
          schedule,
          httpConcurrency: current.httpConcurrency,
          browserConcurrency: current.browserConcurrency,
          githubArchiveLimitMb: current.githubArchiveLimitMb,
          githubMarkdownLimitMb: current.githubMarkdownLimitMb
        })
      }),
    isCrawling: (sourceId) =>
      Boolean(
        crawlTasks.isRunning(sourceId) ||
        states.get(sourceId)?.running ||
        database.getActiveUrlReview(sourceId) ||
        readRuntimeLock(dataDir, `crawl-${sourceId}`)
      ),
    getCrawlState: (sourceId) => {
      const local = states.get(sourceId)
      if (local) return local
      const active = database.getActiveCrawlRun(sourceId)
      return active ? crawlRunState(active) : undefined
    },
    resetCrawlStates: () => states.clear(),
    assertWritable,
    close: async () => {
      await browser.close()
      database.close()
    }
  }
}

function requireSource(database: LociDatabase, sourceId: string): DocumentSource {
  const source = database.listSources().find((item) => item.id === sourceId)
  if (!source) throw new Error('文档源不存在')
  return source
}

function assertNoActiveUrlReview(database: LociDatabase, sourceId: string): void {
  if (database.getActiveUrlReview(sourceId)) {
    throw new Error('文档库正在等待 Agent URL 审查，完成或取消后才能修改')
  }
}
