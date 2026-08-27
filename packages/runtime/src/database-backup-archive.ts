import {
  collectArchiveStream,
  createZipArchive,
  readArchiveJson,
  requireArchiveFile,
  sha256
} from '@loci/core'
import { fromBufferPromise } from 'yauzl'
import { z } from 'zod'
import { parseLociBackup, type LociBackup } from './database-backup-schema.js'

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_ENTRY_BYTES = 256 * 1024 * 1024
const DATA_FILES = [
  ['sources.json', 'sources'],
  ['documents.json', 'documents'],
  ['explicit-page-targets.json', 'explicitPageTargets'],
  ['crawl-runs.json', 'crawlRuns'],
  ['crawl-failures.json', 'crawlFailures'],
  ['hostname-policies.json', 'hostnameCrawlPolicies'],
  ['operation-logs.json', 'operationLogs'],
  ['settings.json', 'settings']
] as const

const indexSchema = z.object({
  format: z.literal('loci-backup-zip'),
  version: z.literal(2),
  appVersion: z.string(),
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string().datetime(),
  files: z.array(
    z.object({
      path: z.string(),
      bytes: z.number().int().nonnegative(),
      records: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u)
    })
  )
})

export interface BackupArchivePreview {
  backup: LociBackup
  sources: number
  documents: number
}

/** ZIP 中每个稳定数据域独立校验；index.json 是导入的唯一文件清单。 */
export async function createBackupArchive(
  backup: LociBackup,
  schemaVersion: number
): Promise<Buffer> {
  const entries = DATA_FILES.map(([path, key]) => {
    const value = backup.data[key] ?? []
    const buffer = Buffer.from(JSON.stringify(value), 'utf8')
    return {
      path,
      buffer,
      records: Array.isArray(value) ? value.length : 1,
      bytes: buffer.length,
      sha256: sha256(buffer)
    }
  })
  const index = Buffer.from(
    JSON.stringify({
      format: 'loci-backup-zip',
      version: 2,
      appVersion: '1.2.1',
      schemaVersion,
      exportedAt: backup.exportedAt,
      files: entries.map(({ path, records, bytes, sha256 }) => ({
        path,
        records,
        bytes,
        sha256
      }))
    }),
    'utf8'
  )
  const mtime = new Date(backup.exportedAt)
  return createZipArchive(
    [
      { path: 'index.json', buffer: index, mtime },
      ...entries.map((entry) => ({ path: entry.path, buffer: entry.buffer, mtime }))
    ],
    MAX_ENTRY_BYTES,
    '备份归档中的单个文件过大'
  )
}

export async function parseBackupArchive(buffer: Buffer): Promise<BackupArchivePreview> {
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error('备份归档不能超过 512 MB')
  const zip = await fromBufferPromise(buffer, {
    lazyEntries: true,
    validateEntrySizes: true,
    strictFileNames: true
  })
  const files = new Map<string, Buffer>()
  let expandedBytes = 0
  try {
    for await (const entry of zip.eachEntry()) {
      validateEntryName(entry.fileName)
      if (entry.fileName.endsWith('/')) continue
      if (files.has(entry.fileName)) throw new Error(`备份归档包含重复文件：${entry.fileName}`)
      if (entry.uncompressedSize > MAX_ENTRY_BYTES) throw new Error('备份归档中的单个文件过大')
      expandedBytes += entry.uncompressedSize
      if (expandedBytes > MAX_ARCHIVE_BYTES) throw new Error('备份归档解压后超过 512 MB')
      files.set(
        entry.fileName,
        await collectArchiveStream(
          await zip.openReadStreamPromise(entry),
          MAX_ENTRY_BYTES,
          '备份归档中的单个文件过大'
        )
      )
    }
  } finally {
    if (zip.isOpen) zip.close()
  }
  const index = indexSchema.parse(
    readArchiveJson(
      requireArchiveFile(files, 'index.json', '备份归档缺少文件：index.json'),
      '备份归档包含无效 JSON'
    )
  )
  const listed = new Set(index.files.map((item) => item.path))
  for (const [path] of DATA_FILES) {
    if (!listed.has(path)) throw new Error(`备份索引缺少数据文件：${path}`)
  }
  if (files.size !== index.files.length + 1) throw new Error('备份归档包含索引外文件')

  const data: Record<string, unknown> = {}
  for (const item of index.files) {
    const content = requireArchiveFile(files, item.path, `备份归档缺少文件：${item.path}`)
    if (content.length !== item.bytes || sha256(content) !== item.sha256) {
      throw new Error(`备份文件校验失败：${item.path}`)
    }
    const key = DATA_FILES.find(([path]) => path === item.path)?.[1]
    if (!key) throw new Error(`备份索引包含未知数据文件：${item.path}`)
    const value = readArchiveJson(content, '备份归档包含无效 JSON')
    const records = Array.isArray(value) ? value.length : 1
    if (records !== item.records) throw new Error(`备份记录数量不一致：${item.path}`)
    data[key] = value
  }
  const backup = parseLociBackup({
    format: 'loci-backup',
    version: 1,
    exportedAt: index.exportedAt,
    data
  })
  return {
    backup,
    sources: backup.data.sources.length,
    documents: backup.data.documents.length
  }
}

function validateEntryName(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    throw new Error('备份归档包含不安全路径')
  }
}
