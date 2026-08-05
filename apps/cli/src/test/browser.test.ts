import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { browserStatus, ensureBrowserInstalled } from '../browser.js'

describe('browserStatus', () => {
  it('returns an actionable missing state without downloading a browser', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-browser-'))
    try {
      const status = await browserStatus(directory)
      expect(status).toMatchObject({ installed: false, launchable: false, error: null })
      expect(status.executable).toContain(directory)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('缺失时要求非交互调用方先手动安装', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-browser-'))
    try {
      await expect(ensureBrowserInstalled(directory)).rejects.toThrow('loci browser install')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('缺失时通过交互回调执行安装并重新检查文件', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-browser-'))
    try {
      const { executable } = await browserStatus(directory)
      let prompted = false
      await ensureBrowserInstalled(
        directory,
        async (install) => {
          prompted = true
          await install()
        },
        async () => {
          mkdirSync(dirname(executable), { recursive: true })
          writeFileSync(executable, '')
          chmodSync(executable, 0o755)
        }
      )
      expect(prompted).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
