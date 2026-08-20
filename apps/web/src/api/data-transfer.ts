import { request } from '@/api/client'

export const BACKUP_FILE_LIMIT_BYTES = 256 * 1024 * 1024

export interface BackupImportResult {
  sources: number
  documents: number
  restartRequired: boolean
}

export interface BackupDownload {
  blob: Blob
  filename: string
}

export async function exportBackup(): Promise<BackupDownload> {
  const response = await request.get<Blob>('/api/data/export', {
    responseType: 'blob',
    timeout: 120_000
  })
  return {
    blob: response.data,
    filename: readAttachmentFilename(response.headers['content-disposition'])
  }
}

export async function importBackup(backup: unknown): Promise<BackupImportResult> {
  return (await request.post<BackupImportResult>('/api/data/import', backup, { timeout: 120_000 }))
    .data
}

export async function readBackupFile(file: File): Promise<unknown> {
  if (file.size > BACKUP_FILE_LIMIT_BYTES) throw new Error('备份文件不能超过 256 MB')
  try {
    return JSON.parse(await file.text()) as unknown
  } catch {
    throw new Error('备份文件不是有效的 JSON')
  }
}

export function readAttachmentFilename(header: unknown): string {
  if (typeof header !== 'string') return 'loci-backup.json'
  const match = /filename="?([^";]+)"?/iu.exec(header)
  return match?.[1] ?? 'loci-backup.json'
}
