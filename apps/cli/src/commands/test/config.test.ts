import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { cliFixture } from './fixture.js'

const cli = cliFixture()

it('独立 CLI 进程同时修改不同配置项保留两次提交', async () => {
  await cli.json('config')
  const entry = fileURLToPath(new URL('../../index.ts', import.meta.url))
  const run = (...args: string[]) =>
    promisify(execFile)(process.execPath, ['--import', 'tsx', entry, 'config', ...args, '--json'])
  await Promise.all([
    run('set', 'theme', 'dark'),
    run('set', 'max-retries', '5'),
    run('domain', 'set', 'docs.test', '--http-concurrency', '2'),
    run('domain', 'set', 'DOCS.TEST', '--browser-concurrency', '3')
  ])
  expect(await cli.json('config')).toMatchObject({ theme: 'dark', maxRetries: 5 })
  expect(await cli.json('config', 'domain', 'list')).toMatchObject([
    { hostname: 'docs.test', httpConcurrency: 2, browserConcurrency: 3 }
  ])
}, 20000)
it('本地配置与域名覆盖经 runtime 校验且可恢复继承', async () => {
  expect(await cli.json('config', 'set', 'http-concurrency', '4')).toEqual({
    'http-concurrency': 4
  })
  await expect(cli.json('config', 'set', 'http-concurrency', '1000')).rejects.toThrow()
  expect(await cli.json('config')).toMatchObject({ httpConcurrency: 4 })
  await cli.json('config', 'domain', 'set', 'DOCS.TEST', '--http-concurrency', '2')
  await cli.json('config', 'domain', 'set', 'docs.test', '--browser-concurrency', '3')
  expect(await cli.json('config', 'domain', 'list')).toMatchObject([
    { hostname: 'docs.test', httpConcurrency: 2, browserConcurrency: 3 }
  ])
  expect(
    await cli.json('config', 'domain', 'set', 'docs.test', '--http-concurrency', 'inherit')
  ).toMatchObject({ httpConcurrency: null, browserConcurrency: 3 })
  await expect(cli.json('config', 'domain', 'remove', 'docs.test')).rejects.toThrow('--yes')
  expect(await cli.json('config', 'domain', 'remove', 'docs.test', '--yes')).toEqual({
    deleted: true
  })
})
