import { basename, posix } from 'node:path'
import { Buffer } from 'node:buffer'
import * as yauzl from 'yauzl'
import type { GithubRepository } from '@loci/shared'
import { throwIfAborted } from './abort.js'
import { rewriteGithubMarkdown } from './github-markdown.js'
import { downloadGithubArchive, readGithubRepositoryMetadata } from './github-download.js'
import {
  DEFAULT_GITHUB_ARCHIVE_LIMIT_BYTES,
  DEFAULT_GITHUB_MARKDOWN_LIMIT_BYTES,
  formatGithubBytes,
  GITHUB_SINGLE_MARKDOWN_LIMIT_BYTES,
  GithubLimitError,
  type GithubBlockedState
} from './github-limits.js'
import type { CrawledDocument, CrawlFailure, CrawlProgress } from './types.js'

const githubEntryLimit = 100_000

export interface GithubSourceOptions {
  repository: GithubRepository
  pageLimit: number
  archiveLimitBytes?: number
  markdownLimitBytes?: number
  previousRevision?: string | null
  blocked?: GithubBlockedState | null
  fetch?: typeof fetch
  signal?: AbortSignal
  onProgress?: (progress: CrawlProgress) => void
}

export interface GithubSourceResult {
  documents: CrawledDocument[]
  progress: CrawlProgress
  defaultBranch: string
  revision: string
  unchanged: boolean
}

/** 下载公开仓库默认分支快照，并只提取受限数量的 Markdown。 */
export async function crawlGithubSource(options: GithubSourceOptions): Promise<GithubSourceResult> {
  const fetchImpl = options.fetch ?? fetch
  const metadata = await readGithubRepositoryMetadata(options.repository, fetchImpl, options.signal)
  const archiveLimit = options.archiveLimitBytes ?? DEFAULT_GITHUB_ARCHIVE_LIMIT_BYTES
  const markdownLimit = options.markdownLimitBytes ?? DEFAULT_GITHUB_MARKDOWN_LIMIT_BYTES
  if (metadata.revision === options.previousRevision) {
    return unchangedResult(metadata.defaultBranch, metadata.revision)
  }
  if (isBlocked(options.blocked, metadata.revision, archiveLimit, markdownLimit)) {
    const blocked = options.blocked!
    throw new GithubLimitError(
      `提交 ${metadata.revision.slice(0, 12)} 已在当前大小上限下同步失败；提高对应上限后可重试`,
      metadata.revision,
      blocked.kind,
      blocked.limitBytes
    )
  }

  const archive = await downloadGithubArchive(
    options.repository,
    metadata.revision,
    archiveLimit,
    fetchImpl,
    options.signal
  )
  try {
    return await readArchive({
      ...options,
      defaultBranch: metadata.defaultBranch,
      revision: metadata.revision,
      archivePath: archive.path,
      markdownLimit
    })
  } finally {
    await archive.cleanup()
  }
}

interface ArchiveReadOptions extends GithubSourceOptions {
  archivePath: string
  defaultBranch: string
  revision: string
  markdownLimit: number
}

async function readArchive(options: ArchiveReadOptions): Promise<GithubSourceResult> {
  const zip = await openZip(options.archivePath)
  const documents: CrawledDocument[] = []
  const failures: CrawlFailure[] = []
  let entries = 0
  let markdownBytes = 0
  let markdownSeen = 0
  let limitReached = false
  try {
    for await (const entry of zipEntries(zip)) {
      throwIfAborted(options.signal)
      entries += 1
      if (entries > githubEntryLimit)
        throw new Error(`GitHub ZIP 条目超过安全上限 ${githubEntryLimit}`)
      const relativePath = normalizeArchivePath(entry.fileName)
      if (!relativePath || !/\.md$/i.test(relativePath)) continue
      if (isSymlink(entry))
        throw new Error(`GitHub ZIP 包含不支持的 Markdown 软链接：${relativePath}`)
      markdownSeen += 1
      if (markdownSeen > options.pageLimit) {
        limitReached = true
        continue
      }
      if (entry.uncompressedSize > GITHUB_SINGLE_MARKDOWN_LIMIT_BYTES) {
        throw new Error(`Markdown 文件超过 5 MB 安全上限：${relativePath}`)
      }
      markdownBytes += entry.uncompressedSize
      if (markdownBytes > options.markdownLimit) {
        throw new GithubLimitError(
          `Markdown 总大小超过 ${formatGithubBytes(options.markdownLimit)} 上限`,
          options.revision,
          'markdown',
          options.markdownLimit
        )
      }
      const buffer = await readEntry(zip, entry, GITHUB_SINGLE_MARKDOWN_LIMIT_BYTES, options.signal)
      throwIfAborted(options.signal)
      const markdown = buffer.toString('utf8')
      const url = githubBlobUrl(options.repository, options.revision, relativePath)
      if (isGitLfsPointer(markdown)) {
        failures.push({
          url,
          reason: 'git_lfs_unsupported',
          message: `Git LFS Markdown 不受支持：${relativePath}`,
          retryable: false
        })
        report(options, documents.length, failures, markdownSeen, limitReached, {
          id: relativePath,
          url,
          title: basename(relativePath),
          status: 'failed'
        })
        continue
      }
      documents.push({
        url,
        title: basename(relativePath),
        language: 'und',
        markdown: rewriteGithubMarkdown(markdown, {
          repository: options.repository,
          revision: options.revision,
          relativePath
        }),
        crawledAt: new Date().toISOString(),
        fetchMode: 'http',
        relativePath
      })
      report(options, documents.length, failures, markdownSeen, limitReached, {
        id: relativePath,
        url,
        title: basename(relativePath),
        status: 'success'
      })
    }
  } finally {
    zip.close()
  }
  const progress = toProgress(documents.length, failures, markdownSeen, limitReached)
  options.onProgress?.(progress)
  return {
    documents,
    progress,
    defaultBranch: options.defaultBranch,
    revision: options.revision,
    unchanged: false
  }
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error('无法打开 GitHub ZIP'))
      else resolve(zip)
    })
  })
}

async function* zipEntries(zip: yauzl.ZipFile): AsyncGenerator<yauzl.Entry> {
  while (true) {
    const entry = await new Promise<yauzl.Entry | null>((resolve, reject) => {
      const onEntry = (value: yauzl.Entry): void => finish(() => resolve(value))
      const onEnd = (): void => finish(() => resolve(null))
      const onError = (error: Error): void => finish(() => reject(error))
      const finish = (action: () => void): void => {
        zip.off('entry', onEntry)
        zip.off('end', onEnd)
        zip.off('error', onError)
        action()
      }
      zip.once('entry', onEntry)
      zip.once('end', onEnd)
      zip.once('error', onError)
      zip.readEntry()
    })
    if (!entry) return
    yield entry
  }
}

function readEntry(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
  limit: number,
  signal?: AbortSignal
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal)
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error(`无法读取 ZIP 条目：${entry.fileName}`))
        return
      }
      const chunks: Buffer[] = []
      let total = 0
      const abort = (): void => {
        stream.destroy(signal?.reason instanceof Error ? signal.reason : new Error('操作已取消'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      stream.on('data', (chunk: Buffer) => {
        total += chunk.byteLength
        if (total > limit)
          stream.destroy(new Error(`ZIP 条目实际大小超过安全上限：${entry.fileName}`))
        else chunks.push(Buffer.from(chunk))
      })
      stream.once('error', (streamError) => {
        signal?.removeEventListener('abort', abort)
        reject(streamError)
      })
      stream.once('end', () => {
        signal?.removeEventListener('abort', abort)
        resolve(Buffer.concat(chunks, total))
      })
    })
  })
}

function normalizeArchivePath(fileName: string): string | null {
  if (fileName.endsWith('/')) return null
  const normalized = posix.normalize(fileName.replace(/\\/g, '/'))
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`GitHub ZIP 包含不安全路径：${fileName}`)
  }
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length < 2 || segments.some((segment) => segment === '..')) return null
  return segments.slice(1).join('/')
}

function isSymlink(entry: yauzl.Entry): boolean {
  const mode = entry.externalFileAttributes >>> 16
  return (mode & 0o170000) === 0o120000
}

function isGitLfsPointer(markdown: string): boolean {
  return markdown.startsWith('version https://git-lfs.github.com/spec/v1\n')
}

function githubBlobUrl(
  repository: GithubRepository,
  revision: string,
  relativePath: string
): string {
  const path = relativePath.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/blob/${encodeURIComponent(revision)}/${path}`
}

function report(
  options: GithubSourceOptions,
  succeeded: number,
  failures: CrawlFailure[],
  processed: number,
  limitReached: boolean,
  node: NonNullable<CrawlProgress['node']>
): void {
  options.onProgress?.({
    ...toProgress(succeeded, failures, processed, limitReached),
    node
  })
}

function toProgress(
  succeeded: number,
  failures: CrawlFailure[],
  processed: number,
  limitReached: boolean
): CrawlProgress {
  return {
    queued: processed,
    processed,
    succeeded,
    failed: failures.length,
    limitReached,
    failures: failures.length ? [...failures] : undefined
  }
}

function unchangedResult(defaultBranch: string, revision: string): GithubSourceResult {
  return {
    documents: [],
    progress: { queued: 0, processed: 0, succeeded: 0, failed: 0, limitReached: false },
    defaultBranch,
    revision,
    unchanged: true
  }
}

function isBlocked(
  blocked: GithubBlockedState | null | undefined,
  revision: string,
  archiveLimit: number,
  markdownLimit: number
): boolean {
  if (!blocked || blocked.revision !== revision) return false
  const currentLimit = blocked.kind === 'archive' ? archiveLimit : markdownLimit
  return currentLimit <= blocked.limitBytes
}
