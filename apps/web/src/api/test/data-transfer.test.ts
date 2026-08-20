import { describe, expect, it } from 'vitest'
import { readAttachmentFilename } from '@/api/data-transfer'
import { formatBytes } from '@/utils/format'

describe('浏览器数据传输', () => {
  it('读取服务端备份文件名并提供安全回退', () => {
    expect(readAttachmentFilename('attachment; filename="loci-backup-2026-08-20.json"')).toBe(
      'loci-backup-2026-08-20.json'
    )
    expect(readAttachmentFilename(undefined)).toBe('loci-backup.json')
  })

  it('使用适合目录卡片的体积单位', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB')
  })
})
