import { join } from 'node:path'
import { expect, it } from 'vitest'
import { cliFixture } from './fixture.js'

const cli = cliFixture()
it('browser status 输出机器可读的真实安装路径与版本', async () => {
  expect(await cli.json('browser', 'status')).toMatchObject({
    installed: false,
    launchable: false,
    executablePath: expect.stringContaining(join(cli.root(), 'cache', 'playwright')),
    playwrightVersion: expect.any(String)
  })
  expect(process.exitCode).toBe(3)
})
