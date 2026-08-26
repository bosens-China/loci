import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram, runCli } from '../../cli.js'
import { createCliRuntime } from '../../runtime.js'

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
  vi.unstubAllGlobals()
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

  it('直接调用指定页面工具并输出逐页状态', async () => {
    const runtime = createCliRuntime()
    const source = runtime.createSource({
      name: 'Docs',
      url: 'https://docs.example.com/guide',
      mode: 'http',
      pageLimit: 10,
      scopePath: '/guide',
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    await runtime.close()
    let output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })

    await createProgram().parseAsync(
      [
        'mcp',
        'call',
        'loci_fetch_pages',
        '--input',
        JSON.stringify({
          library_id: source.id,
          urls: ['https://other.example.com/page'],
          wait_for_completion: true
        })
      ],
      { from: 'user' }
    )

    expect(JSON.parse(output)).toMatchObject({
      library_id: source.id,
      sync_status: 'completed_with_errors',
      items: [{ status: 'failed', message: expect.stringContaining('必须属于') }]
    })
  })

  it('等待同步时保持 stdout 为最终 JSON，并把逐页进度写入 stderr JSONL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Promise.resolve(new Response('<html><title>Docs</title><main><h1>Docs</h1></main></html>'))
      )
    )
    const runtime = createCliRuntime()
    const source = runtime.createSource({
      name: 'Docs',
      url: 'https://docs.example.com/guide',
      mode: 'http',
      pageLimit: 1,
      scopePath: '/guide',
      schedule: null,
      httpConcurrency: null,
      browserConcurrency: null
    })
    await runtime.close()
    let output = ''
    let progressOutput = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      progressOutput += String(chunk)
      return true
    })

    await createProgram().parseAsync(
      [
        'mcp',
        'call',
        'loci_sync_libraries',
        '--input',
        JSON.stringify({ library_ids: [source.id], wait_for_completion: true }),
        '--progress',
        'jsonl'
      ],
      { from: 'user' }
    )

    expect(JSON.parse(output)).toMatchObject({
      items: [{ library_id: source.id, sync_status: 'completed' }]
    })
    const progress = progressOutput
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { message: string })
    expect(progress).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('success Docs https://docs.example.com/guide')
      })
    ])
  })
})
