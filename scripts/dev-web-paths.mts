import { join } from 'node:path'
import { resolveLociCacheDir, resolveLociDataDir } from '../packages/runtime/src/data-path.js'

export type DevDataMode = 'isolated' | 'user'

export interface DevRuntimePaths {
  dataDir: string
  cacheDir: string
  rootDir: string
}

/** 只有显式传入 --user-data 才允许开发服务读取正式用户数据。 */
export function parseDevDataMode(args: readonly string[]): DevDataMode {
  return args.includes('--user-data') ? 'user' : 'isolated'
}

/** 隔离模式固定落在仓库内；用户模式复用 Runtime 的跨平台路径规则。 */
export function resolveDevRuntimePaths(repositoryRoot: string, mode: DevDataMode): DevRuntimePaths {
  if (mode === 'user') {
    const dataDir = resolveLociDataDir()
    return {
      dataDir,
      cacheDir: resolveLociCacheDir(),
      rootDir: dataDir
    }
  }

  const rootDir = join(repositoryRoot, '.loci-dev')
  return {
    dataDir: join(rootDir, 'data'),
    cacheDir: join(rootDir, 'cache'),
    rootDir
  }
}
