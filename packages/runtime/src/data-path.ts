import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** 后台服务和 CLI 必须通过同一规则定位本地数据。 */
export function resolveLociDataDir(): string {
  const override = process.env.LOCI_DATA_DIR?.trim()
  if (override) return resolve(override)

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Loci')
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Loci')
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Loci')
}

export function resolveLociCacheDir(): string {
  const override = process.env.LOCI_CACHE_DIR?.trim()
  if (override) return resolve(override)
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'Loci')
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Loci', 'Cache')
  }
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'loci')
}
