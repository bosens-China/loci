import { describe, expect, it } from 'vitest'
import { defaultBackupFilename } from '../data.js'

describe('数据导出默认文件名', () => {
  it('包含毫秒级时间以避免同一天的备份互相覆盖', () => {
    expect(defaultBackupFilename(new Date('2026-08-04T01:02:03.456Z'))).toBe(
      'loci-backup-2026-08-04T01-02-03-456Z.json'
    )
  })
})
