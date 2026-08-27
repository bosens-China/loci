import { describe, expect, it } from 'vitest'
import {
  BACKUP_FILE_LIMIT_BYTES,
  readAttachmentFilename,
  readBackupFile
} from '@/api/data-transfer'

describe('浏览器数据传输', () => {
  it('读取服务端备份文件名并提供安全回退', () => {
    expect(readAttachmentFilename('attachment; filename="loci-backup-2026-08-20.zip"')).toBe(
      'loci-backup-2026-08-20.zip'
    )
    expect(readAttachmentFilename(undefined)).toBe('loci-backup.zip')
  })

  it('拒绝超过导入上限的备份文件', async () => {
    const file = new File(['PK\u0003\u0004'], 'backup.zip')
    Object.defineProperty(file, 'size', { value: BACKUP_FILE_LIMIT_BYTES + 1 })

    await expect(readBackupFile(file)).rejects.toThrow('备份文件不能超过 512 MB')
  })

  it('拒绝非 ZIP 文件，并接受 ZIP 签名', async () => {
    await expect(readBackupFile(new File(['{'], 'backup.json'))).rejects.toThrow(
      '请选择 Loci ZIP 备份文件'
    )
    const archive = new File(['PK\u0003\u0004content'], 'backup.zip')
    await expect(readBackupFile(archive)).resolves.toBe(archive)
  })
})
