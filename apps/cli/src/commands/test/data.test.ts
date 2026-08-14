import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProgram } from '../../cli.js'
import { CliError } from '../../errors.js'
import { defaultBackupFilename } from '../data.js'

let directory = ''

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'loci-cli-data-'))
  process.env.LOCI_DATA_DIR = join(directory, 'data')
})

afterEach(() => {
  delete process.env.LOCI_DATA_DIR
  rmSync(directory, { recursive: true, force: true })
})

describe('数据导出默认文件名', () => {
  it('包含毫秒级时间以避免同一天的备份互相覆盖', () => {
    expect(defaultBackupFilename(new Date('2026-08-04T01:02:03.456Z'))).toBe(
      'loci-backup-2026-08-04T01-02-03-456Z.json'
    )
  })

  it('用清晰错误说明备份文件不是有效 JSON', async () => {
    const backup = join(directory, 'invalid.json')
    writeFileSync(backup, '{invalid', 'utf8')

    const error = await createProgram()
      .parseAsync(['data', 'import', backup, '--yes'], { from: 'user' })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).message).toBe('备份文件不是有效 JSON，请确认文件来源')
  })

  it('非交互清理明确要求传入 --yes', async () => {
    await expect(
      createProgram().parseAsync(['data', 'clear-documents'], { from: 'user' })
    ).rejects.toThrow('非交互终端请传入 --yes')
  })
})
