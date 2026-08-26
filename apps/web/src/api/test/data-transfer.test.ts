import { describe, expect, it } from 'vitest'
import {
  BACKUP_FILE_LIMIT_BYTES,
  readAttachmentFilename,
  readBackupFile
} from '@/api/data-transfer'

describe('浏览器数据传输', () => {
  it('读取服务端备份文件名并提供安全回退', () => {
    expect(readAttachmentFilename('attachment; filename="loci-backup-2026-08-20.json"')).toBe(
      'loci-backup-2026-08-20.json'
    )
    expect(readAttachmentFilename(undefined)).toBe('loci-backup.json')
  })

  it('拒绝超过导入上限的备份文件', async () => {
    const file = new File(['{}'], 'backup.json')
    Object.defineProperty(file, 'size', { value: BACKUP_FILE_LIMIT_BYTES + 1 })

    await expect(readBackupFile(file)).rejects.toThrow('备份文件不能超过 256 MB')
  })

  it('拒绝无效 JSON，并解析有效备份', async () => {
    await expect(readBackupFile(new File(['{'], 'backup.json'))).rejects.toThrow(
      '备份文件不是有效的 JSON'
    )
    await expect(readBackupFile(new File(['{"sources":[]}'], 'backup.json'))).resolves.toEqual({
      sources: []
    })
  })
})
