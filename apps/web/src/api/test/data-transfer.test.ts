import { describe, expect, it } from 'vitest'
import { readAttachmentFilename, readBackupFile } from '@/api/data-transfer'

describe('浏览器数据传输', () => {
  it('读取服务端备份文件名并提供安全回退', () => {
    expect(readAttachmentFilename('attachment; filename="loci-backup-2026-08-20.zip"')).toBe(
      'loci-backup-2026-08-20.zip'
    )
    expect(readAttachmentFilename(undefined)).toBe('loci-backup.zip')
  })

  it('拒绝非 ZIP 文件，并接受 ZIP 签名', async () => {
    await expect(readBackupFile(new File(['{'], 'backup.json'))).rejects.toThrow()
    const archive = new File(['PK\u0003\u0004content'], 'backup.zip')
    Object.defineProperty(archive, 'size', { value: 513 * 1024 * 1024 })
    await expect(readBackupFile(archive)).resolves.toBe(archive)
  })
})
