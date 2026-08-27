import { request } from '@/api/client'

export const BACKUP_FILE_LIMIT_BYTES = 512 * 1024 * 1024

export interface BackupImportResult {
  sources: number
  documents: number
  backgroundError: string | null
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

export async function importBackup(backup: Blob): Promise<BackupImportResult> {
  return (
    await request.post<BackupImportResult>('/api/data/import', backup, {
      timeout: 120_000,
      headers: { 'Content-Type': 'application/zip' }
    })
  ).data
}

export async function readBackupFile(file: File): Promise<Blob> {
  if (file.size > BACKUP_FILE_LIMIT_BYTES) throw new Error('备份文件不能超过 512 MB')
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error('请选择 Loci ZIP 备份文件')
  return file
}

export function readAttachmentFilename(header: unknown): string {
  if (typeof header !== 'string') return 'loci-backup.zip'
  const match = /filename="?([^";]+)"?/iu.exec(header)
  return match?.[1] ?? 'loci-backup.zip'
}
