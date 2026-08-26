import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProgram } from '../../cli.js'
import { createCliRuntime } from '../../runtime.js'

const originalDataDir = process.env.LOCI_DATA_DIR
const originalServerUrl = process.env.LOCI_SERVER_URL
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'loci-config-dx-'))
  process.env.LOCI_DATA_DIR = dataDir
  delete process.env.LOCI_SERVER_URL
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
  if (originalServerUrl === undefined) delete process.env.LOCI_SERVER_URL
  else process.env.LOCI_SERVER_URL = originalServerUrl
})

describe('CLI 共享设置', () => {
  it('保存显式提供的设置值', async () => {
    await createProgram().parseAsync(['config', 'set', 'max-retries', '4'], { from: 'user' })

    const runtime = createCliRuntime()
    expect(runtime.database.getSettings().maxRetries).toBe(4)
    await runtime.close()
  })

  it('保存 GitHub 下载和 Markdown 默认上限', async () => {
    await createProgram().parseAsync(['config', 'set', 'github-archive-limit-mb', '300'], {
      from: 'user'
    })
    await createProgram().parseAsync(['config', 'set', 'github-markdown-limit-mb', '150'], {
      from: 'user'
    })

    const runtime = createCliRuntime()
    expect(runtime.database.getSettings()).toMatchObject({
      githubArchiveLimitMb: 300,
      githubMarkdownLimitMb: 150
    })
    await runtime.close()
  })

  it('环境变量覆盖 Server 地址时拒绝伪装保存成功', async () => {
    await createProgram().parseAsync(
      ['config', 'set', 'server-url', 'https://persisted.example.com'],
      { from: 'user' }
    )
    process.env.LOCI_SERVER_URL = 'https://override.example.com'

    await expect(
      createProgram().parseAsync(['config', 'set', 'server-url', 'https://ignored.example.com'], {
        from: 'user'
      })
    ).rejects.toThrow('LOCI_SERVER_URL 正在覆盖 Server 地址')

    delete process.env.LOCI_SERVER_URL
    const runtime = createCliRuntime()
    expect(runtime.database.getSettings().serverUrl).toBe('https://persisted.example.com')
    await runtime.close()
  })
})
