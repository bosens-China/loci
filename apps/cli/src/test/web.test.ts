import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { cliFixture } from '../commands/test/fixture.js'

cliFixture()
it('ui 在前台提供回环 HTTP，SIGTERM 关闭监听器并正常退出', async () => {
  const entry = fileURLToPath(new URL('../index.ts', import.meta.url))
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', entry, 'ui', '--port', '0', '--no-open', '--json'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const closed = once(child, 'close')
  const lines = createInterface({ input: child.stdout })
  try {
    const [line] = await Promise.race([
      once(lines, 'line'),
      closed.then(() => {
        throw new Error('Web 进程提前结束')
      })
    ])
    const { url } = JSON.parse(String(line)) as { url: string }
    expect(new URL(url).hostname).toBe('127.0.0.1')
    expect(await (await fetch(`${url}/health`)).json()).toMatchObject({ pid: child.pid })
    child.kill('SIGTERM')
    expect(await closed).toEqual([0, null])
    await expect(fetch(`${url}/health`)).rejects.toThrow()
  } finally {
    lines.close()
    child.kill()
    await closed
  }
}, 15000)
