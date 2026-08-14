import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram } from '../../cli.js'
import { CliError } from '../../errors.js'
import { createCliRuntime } from '../../runtime.js'

const originalDataDir = process.env.LOCI_DATA_DIR
const originalServerUrl = process.env.LOCI_SERVER_URL
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'loci-source-defaults-'))
  process.env.LOCI_DATA_DIR = dataDir
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  rmSync(dataDir, { recursive: true, force: true })
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
  if (originalServerUrl === undefined) delete process.env.LOCI_SERVER_URL
  else process.env.LOCI_SERVER_URL = originalServerUrl
})

describe('文档源最短输入', () => {
  it('允许本地开发覆盖默认 Server 地址', async () => {
    process.env.LOCI_SERVER_URL = 'http://localhost:7001'
    const runtime = createCliRuntime()
    expect(runtime.database.getSettings().serverUrl).toBe('http://localhost:7001')
    await runtime.close()
  })

  it('只提供 URL 时采用共享名称和抓取默认值', async () => {
    await createProgram().parseAsync(
      ['source', 'add', 'https://rspress.rs/guide/introduction.html', '--no-sync'],
      {
        from: 'user'
      }
    )

    const runtime = createCliRuntime()
    const source = runtime.database.listSources()[0]
    await runtime.close()
    expect(source).toMatchObject({
      name: 'rspress',
      url: 'https://rspress.rs/guide/introduction.html',
      mode: 'auto',
      pageLimit: 1000,
      scopePath: '/',
      httpConcurrency: null,
      browserConcurrency: null
    })
  })

  it('部分更新保留没有显式提供的字段', async () => {
    const isTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    try {
      await createProgram().parseAsync(
        ['source', 'add', 'https://rspress.rs/guide/introduction.html', '--no-sync'],
        { from: 'user' }
      )
      await createProgram().parseAsync(['source', 'update', 'rspress', '--page-limit', '300'], {
        from: 'user'
      })
    } finally {
      if (isTTYDescriptor) Object.defineProperty(process.stdin, 'isTTY', isTTYDescriptor)
      else Reflect.deleteProperty(process.stdin, 'isTTY')
    }

    const runtime = createCliRuntime()
    const source = runtime.database.listSources()[0]
    await runtime.close()
    expect(source).toMatchObject({
      name: 'rspress',
      url: 'https://rspress.rs/guide/introduction.html',
      mode: 'auto',
      pageLimit: 300,
      scopePath: '/'
    })
  })

  it('创建、更新和清空排除路径正则', async () => {
    await createProgram().parseAsync(
      [
        'source',
        'add',
        'https://rspress.rs/guide/introduction.html',
        '--exclude-path',
        '^/(zh|de)(?:/|$)',
        '--no-sync'
      ],
      { from: 'user' }
    )
    await createProgram().parseAsync(
      ['source', 'update', 'rspress', '--exclude-path', '^/fr(?:/|$)'],
      { from: 'user' }
    )
    let runtime = createCliRuntime()
    expect(runtime.database.listSources()[0]?.excludePathPattern).toBe('^/fr(?:/|$)')
    await runtime.close()

    await createProgram().parseAsync(['source', 'update', 'rspress', '--exclude-path', ''], {
      from: 'user'
    })
    runtime = createCliRuntime()
    expect(runtime.database.listSources()[0]?.excludePathPattern).toBeNull()
    await runtime.close()
  })

  it('识别 GitHub 仓库并接受大小上限参数', async () => {
    await createProgram().parseAsync(
      [
        'source',
        'add',
        'https://github.com/vuejs/docs/tree/main/src',
        '--archive-limit',
        '250mb',
        '--markdown-limit',
        '120',
        '--no-sync'
      ],
      { from: 'user' }
    )

    const runtime = createCliRuntime()
    const source = runtime.database.listSources()[0]
    await runtime.close()
    expect(source).toMatchObject({
      name: 'docs',
      url: 'https://github.com/vuejs/docs',
      kind: 'github',
      mode: 'auto',
      scopePath: '/',
      githubArchiveLimitMb: 250,
      githubMarkdownLimitMb: 120
    })
  })

  it('非交互环境不接受没有修改项的空更新', async () => {
    await createProgram().parseAsync(
      ['source', 'add', 'https://rspress.rs/guide/introduction.html', '--no-sync'],
      {
        from: 'user'
      }
    )

    const error = await createProgram()
      .parseAsync(['source', 'update', 'rspress'], { from: 'user' })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).message).toContain('至少提供一个')
  })

  it('可以用独立命令设置和关闭本地定时计划', async () => {
    await createProgram().parseAsync(['source', 'add', 'https://rspress.rs/guide', '--no-sync'], {
      from: 'user'
    })
    await createProgram().parseAsync(['schedule', 'set', 'rspress', '0 2 * * *'], {
      from: 'user'
    })
    let runtime = createCliRuntime()
    expect(runtime.database.listSources()[0]?.schedule).toBe('0 2 * * *')
    await runtime.close()

    await createProgram().parseAsync(['schedule', 'set', 'rspress', 'manual'], { from: 'user' })
    runtime = createCliRuntime()
    expect(runtime.database.listSources()[0]?.schedule).toBeNull()
    await runtime.close()
  })

  it('带 URL 创建后默认执行一次首次同步', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) =>
        String(input).endsWith('/docs')
          ? new Response('<html><title>Docs</title><main><h1>Docs</h1></main></html>')
          : new Response('', { status: 404 })
      )
    )
    await createProgram().parseAsync(
      ['source', 'add', 'https://example.com/docs', '--mode', 'http', '--page-limit', '1'],
      { from: 'user' }
    )
    const runtime = createCliRuntime()
    expect(runtime.database.listSources()[0]).toMatchObject({ pages: 1, status: 'healthy' })
    expect(runtime.database.listCrawlHistory()[0]).toMatchObject({ succeeded: 1 })
    await runtime.close()
  })
})
