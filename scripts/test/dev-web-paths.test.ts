import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseDevDataMode, resolveDevRuntimePaths } from '../dev-web-paths.mts'

const originalDataDir = process.env.LOCI_DATA_DIR
const originalCacheDir = process.env.LOCI_CACHE_DIR

afterEach(() => {
  restoreEnvironment('LOCI_DATA_DIR', originalDataDir)
  restoreEnvironment('LOCI_CACHE_DIR', originalCacheDir)
})

describe('dev web paths', () => {
  it('默认使用仓库内的隔离数据目录', () => {
    const rootDir = join('/workspace/loci', '.loci-dev')
    expect(parseDevDataMode([])).toBe('isolated')
    expect(resolveDevRuntimePaths('/workspace/loci', 'isolated')).toEqual({
      dataDir: join(rootDir, 'data'),
      cacheDir: join(rootDir, 'cache'),
      rootDir
    })
  })

  it('只有显式参数才启用用户数据模式', () => {
    expect(parseDevDataMode(['--user-data'])).toBe('user')
    expect(parseDevDataMode(['--host', '127.0.0.1'])).toBe('isolated')
  })

  it('用户数据模式遵循 Runtime 的环境变量覆盖', () => {
    process.env.LOCI_DATA_DIR = './fixtures/user-data'
    process.env.LOCI_CACHE_DIR = './fixtures/user-cache'

    expect(resolveDevRuntimePaths('/workspace/loci', 'user')).toEqual({
      dataDir: resolve('./fixtures/user-data'),
      cacheDir: resolve('./fixtures/user-cache'),
      rootDir: resolve('./fixtures/user-data')
    })
  })
})

function restoreEnvironment(name: 'LOCI_DATA_DIR' | 'LOCI_CACHE_DIR', value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
