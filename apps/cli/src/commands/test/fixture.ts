import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, vi } from 'vitest'
import { runCli } from '../../cli.js'

/** 每次调用模拟独立的 CLI 会话，解析整个 stdout 以捕获混入的提示。 */
export function cliFixture() {
  let root: string
  let stdout = ''
  const exitCode = process.exitCode
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'loci-cli-'))
    for (const [key, folder] of Object.entries({
      LOCI_DATA_DIR: 'data',
      LOCI_CACHE_DIR: 'cache',
      HOME: 'home',
      USERPROFILE: 'home',
      CODEX_HOME: 'home/.codex'
    }))
      vi.stubEnv(key, join(root, folder))
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk)
      return true
    })
    process.exitCode = undefined
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    process.exitCode = exitCode
    rmSync(root, { recursive: true, force: true })
  })
  async function text(...args: string[]) {
    stdout = ''
    await runCli(args)
    return stdout
  }
  return {
    root: () => root,
    text,
    json: async <T = unknown>(...args: string[]): Promise<T> =>
      JSON.parse(await text(...args, '--json')) as T
  }
}
