import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram, runCli } from '../../cli.js'

const originalDataDir = process.env.LOCI_DATA_DIR
const originalCacheDir = process.env.LOCI_CACHE_DIR
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'loci-mcp-call-'))
  process.env.LOCI_DATA_DIR = dataDir
  process.env.LOCI_CACHE_DIR = dataDir
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dataDir, { recursive: true, force: true })
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
  if (originalCacheDir === undefined) delete process.env.LOCI_CACHE_DIR
  else process.env.LOCI_CACHE_DIR = originalCacheDir
})

describe('MCP 工具直接调用', () => {
  it('使用默认输入并只向 stdout 输出结构化 JSON', async () => {
    let output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })

    await createProgram().parseAsync(['mcp', 'call', 'loci_list_libraries'], { from: 'user' })

    expect(JSON.parse(output)).toMatchObject({ total_count: 0, count: 0, items: [] })
  })

  it('拒绝无效 JSON、未知工具和不符合 Schema 的输入', async () => {
    await expect(
      createProgram().parseAsync(['mcp', 'call', 'loci_list_libraries', '--input', '{'], {
        from: 'user'
      })
    ).rejects.toMatchObject({ message: '--input 必须是有效 JSON', exitCode: 2 })
    await expect(
      createProgram().parseAsync(['mcp', 'call', 'loci_unknown'], { from: 'user' })
    ).rejects.toMatchObject({ message: expect.stringContaining('未知 Loci MCP 工具'), exitCode: 2 })
    await expect(
      createProgram().parseAsync(
        ['mcp', 'call', 'loci_get_library_tree', '--input', '{"depth":8}'],
        { from: 'user' }
      )
    ).rejects.toMatchObject({ message: expect.stringContaining('工具输入不合法'), exitCode: 2 })
  })

  it('存在更新缓存时仍保持 stdout 为纯 JSON', async () => {
    writeFileSync(
      join(dataDir, 'cli-update.json'),
      `${JSON.stringify({ latestVersion: '99.0.0' })}\n`,
      'utf8'
    )
    let output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })

    await runCli(['mcp', 'call', 'loci_list_libraries'])

    expect(() => JSON.parse(output)).not.toThrow()
  })
})
