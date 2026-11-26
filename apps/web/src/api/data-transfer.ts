import type {
  BackupImportSummary,
  ClearDataCounts,
  ClearDataScope,
  ClearDataSummary
} from '@loci/shared'
import { request } from './client'

export const BACKUP_FILE_LIMIT_BYTES = 512 * 1024 * 1024

export interface BackupDownload {
  blob: Blob
  filename: string
}

export const getClearDataCounts = async (): Promise<ClearDataCounts> => {
  const { data } = await request.get<ClearDataCounts>('/api/data/counts')
  return data
}

export const clearData = async (scope: ClearDataScope): Promise<ClearDataSummary> => {
  const { data } = await request.post<ClearDataSummary>(
    '/api/data/clear',
    { scope },
    {
      timeout: 120_000
    }
  )
  return data
}

/** 分类逐项编码为可重复的查询参数。 */
export const exportBackup = async (categories?: readonly string[]): Promise<BackupDownload> => {
  const params = new URLSearchParams()
  for (const category of categories ?? []) params.append('category', category)
  const response = await request.get<Blob>('/api/data/export', {
    params,
    responseType: 'blob',
    timeout: 120_000
  })
  return {
    blob: response.data,
    filename: readAttachmentFilename(response.headers['content-disposition'])
  }
}

/** 默认合并，显式选择后才清空本地文档库。 */
export const importBackup = async (
  backup: Blob,
  replaceAll: boolean
): Promise<BackupImportSummary> => {
  const { data } = await request.post<BackupImportSummary>('/api/data/import', backup, {
    params: { mode: replaceAll ? 'replace' : 'merge' },
    timeout: 120_000,
    headers: { 'Content-Type': 'application/zip' }
  })
  return data
}

/** 校验并读取待导入的 ZIP 文件。 */
export const readBackupFile = async (file: File): Promise<Blob> => {
  if (file.size > BACKUP_FILE_LIMIT_BYTES) throw new Error('备份文件不能超过 512 MB')
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error('请选择 Loci ZIP 备份文件')
  return file
}

/** 从 HTTP 响应头提取 Content-Disposition 文件名。 */
export const readAttachmentFilename = (header: unknown): string => {
  if (typeof header !== 'string') return 'loci-backup.zip'
  const match = /filename="?([^";]+)"?/iu.exec(header)
  return match?.[1] ?? 'loci-backup.zip'
}
