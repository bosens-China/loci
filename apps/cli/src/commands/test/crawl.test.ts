import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { acquireMaintenanceRuntimeLock, readRuntimeLock } from '@loci/runtime'
import { expect, it, vi } from 'vitest'
import { withRuntime } from '../../command-runtime.js'
import { CLI_VERSION } from '../../update.js'
import { cliFixture } from './fixture.js'

const cli = cliFixture()
function childCli(...args: string[]) {
  const entry = fileURLToPath(new URL('../../index.ts', import.meta.url))
  const child = spawn(process.execPath, ['--import', 'tsx', entry, ...args, '--json'], {
    cwd: fileURLToPath(new URL('../../../../../', import.meta.url)),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = '',
    stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const done = new Promise<{ code: number | null; value: unknown; stderr: string }>(
    (resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => {
        try {
          resolve({ code, value: JSON.parse(stdout), stderr })
        } catch {
          reject(new Error(`stdout=${stdout}, stderr=${stderr}`))
        }
      })
    }
  )
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 15000)
  child.once('close', () => clearTimeout(watchdog))
  return { child, done }
}

it('只读探测、直接抓取、精确补抓、失败原因和状态可从独立进程读取', async () => {
  let hold = false
  const site = createServer((req, res) => {
    if (req.url === '/llms.txt') res.end('- [Guide](/guide.md)')
    else if (req.url === '/guide.md') res.end('# Guide\n\nquickstart')
    else if (req.url === '/extra' && !hold)
      res.end('<main><h1>Extra</h1><p>extra body</p><a href="/unwanted">extra</a></main>')
    else if (req.url !== '/extra') res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
  const address = site.address()
  if (!address || typeof address === 'string') throw new Error('测试监听失败')
  const base = `http://127.0.0.1:${address.port}`
  try {
    expect(await cli.json('fetch', base, '--inspect')).toMatchObject([
      { discovery: 'llms', estimatedPages: 1, pathGroups: [{ path: '/guide.md', pages: 1 }] }
    ])
    expect(existsSync(join(cli.root(), 'data'))).toBe(false)
    const result = await childCli(
      'fetch',
      base,
      '--wait',
      '--http-concurrency',
      '2',
      '--browser-concurrency',
      '3'
    ).done
    expect(result).toMatchObject({
      code: 0,
      value: [{ status: 'completed', succeeded: 1, failed: 0 }]
    })
    expect(result.stderr).toContain(base)
    const [source] = await cli.json<{ id: string; name: string }[]>('list')
    expect(source).toMatchObject({ category: '未分类', version: 'latest' })
    const id = source!.id
    const savedConfig = () => withRuntime((runtime) => runtime.database.getSourceConfig(id))
    expect(await savedConfig()).toMatchObject({ httpConcurrency: 2, browserConcurrency: 3 })
    expect(await cli.json('status')).toMatchObject([
      { libraryId: id, status: 'completed', progress: { processed: 1, succeeded: 1 } }
    ])
    const hidden = await cli.json('fetch', base, base + '/extra', '--mode', 'http', '--wait')
    expect(hidden).toMatchObject([{ status: 'completed', succeeded: 2, failed: 0 }])
    expect(await withRuntime((r) => r.database.listExplicitPageTargets(id))).toMatchObject([
      { url: base + '/extra', status: 'current' }
    ])
    await cli.json(
      'update',
      id,
      '--wait',
      '--category',
      '更新分类',
      '--version',
      'latest',
      '--name',
      'Local',
      '--mode',
      'http',
      '--http-concurrency',
      '3',
      '--browser-concurrency',
      '4',
      '--pages',
      base + '/extra'
    )
    expect(await savedConfig()).toMatchObject({ httpConcurrency: 3, browserConcurrency: 4 })
    expect(await cli.json('list', '--category', '更新分类', '--version', 'latest')).toMatchObject([
      { id, category: '更新分类', version: 'latest' }
    ])
    expect(await cli.json('list', 'Local')).toHaveLength(2)
    const partial = await childCli('fetch', base + '/extra', base + '/gone', '--to', id, '--wait')
      .done
    expect(partial).toMatchObject({
      code: 1,
      value: [
        {
          status: 'completed_with_errors',
          succeeded: 1,
          failed: 1,
          failures: [{ url: base + '/gone', reason: expect.any(String) }]
        }
      ]
    })
    expect(await cli.json('status', id)).toMatchObject({
      status: 'completed_with_errors',
      failures: [{ url: base + '/gone', message: expect.any(String) }],
      finishedAt: expect.any(String)
    })
    expect(await cli.text('status', id)).toContain(base + '/gone')
    hold = true
    const running = childCli('fetch', base + '/extra', '--pages', '--wait')
    try {
      await vi.waitFor(
        async () =>
          expect(await cli.json('status', id)).toMatchObject({
            status: 'running',
            progress: { currentUrl: base + '/extra' }
          }),
        { timeout: 15000, interval: 100 }
      )
      running.child.kill('SIGINT')
      expect(await running.done).toMatchObject({ code: 130, value: [{ status: 'cancelled' }] })
      expect(await cli.json('status', id)).toMatchObject({
        status: 'cancelled',
        error: expect.any(String)
      })
    } finally {
      running.child.kill()
      await running.done.catch(() => undefined)
    }
    hold = false
    await cli.json('update', '--wait', '--all', '--pages', base + '/extra')
    expect(await cli.json('status', id)).toMatchObject({
      status: 'completed',
      progress: { succeeded: 1 }
    })
    const versioned = await cli.json<{ libraryId: string }[]>(
      'fetch',
      base,
      '--version',
      'v18',
      '--wait'
    )
    expect(versioned[0]?.libraryId).not.toBe(id)
    expect(await cli.json('list', '--version', 'v18')).toMatchObject([
      { id: versioned[0]!.libraryId, category: '未分类' }
    ])
    expect(await cli.json('list', '--version', 'latest')).toMatchObject([{ id }])
    const historicalId = versioned[0]!.libraryId
    expect(await cli.json('update', '--all', '--wait', '--pages', base + '/extra')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ libraryId: id, status: 'completed' }),
        expect.objectContaining({ libraryId: historicalId, status: 'completed' })
      ])
    )
    expect(await cli.json('list', '--category', '更新分类', '--version', 'latest')).toMatchObject([
      { id }
    ])
    expect(await cli.json('list', '--version', 'v18')).toMatchObject([{ id: historicalId }])
    expect(await cli.json('list', id)).toHaveLength(2)
    const invalid = await childCli('tree', 'no-such-library').done
    expect(invalid).toMatchObject({ value: { error: expect.any(String) }, code: 2 })
    expect(invalid.stderr).toContain('no-such-library')
  } finally {
    site.closeAllConnections()
    await new Promise<void>((resolve) => site.close(() => resolve()))
  }
}, 45000)

it('跨进程重复启动整库抓取复用同一进度，分离调用方不会重复请求正文', async () => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let pageRequests = 0
  const site = createServer(async (req, res) => {
    if (req.url === '/llms.txt') return res.end('- [Guide](/guide.md)')
    if (req.url !== '/guide.md') return res.writeHead(404).end()
    pageRequests++
    await pending
    res.end('# Guide\n\ncontent')
  })
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
  const address = site.address()
  if (!address || typeof address === 'string') throw new Error('测试监听失败')
  const url = `http://127.0.0.1:${address.port}/`
  try {
    expect((await cli.text('--version')).trim()).toBe(CLI_VERSION)
    const results = await Promise.all([
      childCli('fetch', url, '--category', '自定义分类', '--version', 'v2.0').done,
      childCli('fetch', url, '--category', '自定义分类', '--version', 'v2.0').done
    ])
    expect(results.map((r) => r.code)).toEqual([0, 0])
    const rows = results.map(
      (r) => (r.value as { libraryId: string; runId: string; reused: boolean }[])[0]!
    )
    const { libraryId: id, runId } = rows[0]!
    expect(await cli.json('list', '--category', '自定义分类', '--version', 'v2.0')).toMatchObject([
      { id, category: '自定义分类', version: 'v2.0' }
    ])
    expect(await cli.json('list', '--category', '自定义分类', '--version', 'v2')).toEqual([])
    expect(await cli.json('list', '--category', '自定义', '--version', 'v2.0')).toEqual([])
    const categories = await cli.json<{ name: string; libraryCount: number }[]>('category')
    expect(categories.filter((c) => c.name === '自定义分类')).toMatchObject([{ libraryCount: 1 }])
    expect(rows.map((r) => r.reused).sort()).toEqual([false, true])
    for (const row of rows) expect(row).toMatchObject({ libraryId: id, runId, status: 'running' })
    expect(await childCli('status', id).done).toMatchObject({
      code: 0,
      value: { status: 'running', runId }
    })
    await vi.waitFor(() => expect(pageRequests).toBe(1))
    release()
    await vi.waitFor(async () =>
      expect(await cli.json('status', id)).toMatchObject({
        status: 'completed',
        runId,
        progress: { succeeded: 1 }
      })
    )
    expect(pageRequests).toBe(1)
    expect(await cli.json('cancel', id)).toMatchObject({ cancelled: false, status: 'completed' })
  } finally {
    release()
    site.closeAllConnections()
    await new Promise<void>((resolve) => site.close(() => resolve()))
  }
}, 30000)

it('子进程无法取得抓取锁时向启动方报告错误，库仍可安全查询和取消', async () => {
  await withRuntime(async (runtime) => {
    const { id } = runtime.createSource({ url: 'https://example.test' })
    const lock = acquireMaintenanceRuntimeLock(runtime.dataDir, '集成测试维护')
    try {
      expect(await childCli('update', id).done).toMatchObject({
        code: 1,
        value: { error: expect.stringContaining('维护') }
      })
      expect(await cli.json('status', id)).toBeNull()
      expect(await cli.json('cancel', id)).toMatchObject({
        libraryId: id,
        cancelled: false,
        status: 'idle'
      })
    } finally {
      lock.release()
    }
  })
}, 15000)

it.each([false, true])(
  '多库更新按库取消，其他库继续且取消的库可以重试（前台等待 %s）',
  async (wait) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const site = createServer(async (req, res) => {
      if (req.url === '/a' || req.url === '/b') {
        await held
        res.end('<main><h1>Guide</h1><p>guide body</p></main>')
      } else res.writeHead(404).end()
    })
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
    const address = site.address()
    if (!address || typeof address === 'string') throw new Error('测试监听失败')
    const base = `http://127.0.0.1:${address.port}`
    const [a, b] = await withRuntime((r) =>
      ['/a', '/b'].map(
        (scopePath) => r.createSource({ url: base + scopePath, scopePath, mode: 'http' }).id
      )
    )
    const foreground = wait
      ? childCli('update', '--all', '--wait', '--pages', base + '/a')
      : undefined
    try {
      if (foreground) {
        await vi.waitFor(
          async () =>
            expect(await cli.json('status')).toMatchObject([
              { status: 'running' },
              { status: 'running' }
            ]),
          { timeout: 8000 }
        )
      } else {
        const started = await cli.json<{ libraryId: string; reused: boolean; status: string }[]>(
          'update',
          '--all',
          '--pages',
          base + '/a'
        )
        expect(started).toHaveLength(2)
        expect(started.map((s) => s.libraryId).sort()).toEqual([a, b].sort())
        expect(started.every((s) => s.status === 'running' && !s.reused)).toBe(true)
        const current = started.find((item) => item.libraryId === a)
        expect(await childCli('fetch', base + '/a#anchor', '--to', a!).done).toMatchObject({
          code: 0,
          value: [{ ...current, reused: true }]
        })
        expect(await childCli('fetch', base + '/b', '--to', a!).done).toMatchObject({
          code: 1,
          value: { error: expect.stringContaining('其他抓取') }
        })
      }
      const pid = await withRuntime((r) => readRuntimeLock(r.dataDir, `crawl-${a}`)?.pid)
      expect(pid).toBeTypeOf('number')
      expect(await childCli('cancel', a!).done).toMatchObject({
        code: 0,
        value: { libraryId: a, cancelled: true, status: 'cancelled' }
      })
      expect(await cli.json('status', a!)).toMatchObject({
        status: 'cancelled',
        finishedAt: expect.any(String)
      })
      expect(await cli.json('status', b!)).toMatchObject({ status: 'running' })
      if (!foreground)
        await vi.waitFor(() => expect(() => process.kill(pid!, 0)).toThrow(), { timeout: 5000 })
      release()
      if (foreground) {
        expect(await foreground.done).toMatchObject({
          code: 130,
          value: expect.arrayContaining([
            {
              libraryId: a,
              status: 'cancelled',
              succeeded: 0,
              failed: 0,
              error: expect.any(String)
            },
            { libraryId: b, status: 'completed', succeeded: 1, failed: 0 }
          ])
        })
      }
      await vi.waitFor(async () =>
        expect(await cli.json('status', b!)).toMatchObject({ status: 'completed' })
      )
      expect(await childCli('update', a!, '--pages', base + '/b').done).toMatchObject({
        code: 0,
        value: [{ status: 'running', reused: false }]
      })
      await vi.waitFor(async () =>
        expect(await cli.json('status', a!)).toMatchObject({
          status: 'completed',
          progress: { currentUrl: base + '/b', succeeded: 1 }
        })
      )
    } finally {
      release()
      await foreground?.done.catch(() => undefined)
      site.closeAllConnections()
      await new Promise<void>((resolve) => site.close(() => resolve()))
    }
  },
  30000
)
