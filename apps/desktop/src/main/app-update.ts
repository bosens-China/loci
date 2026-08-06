import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, shell } from 'electron'
import { isNewerVersion } from '@loci/shared'
import type { DesktopUpdateState } from '@loci/shared'

export { isNewerVersion } from '@loci/shared'

const CACHE_FILE = 'update-check.json'
const RELEASES_URL = 'https://github.com/bosens-China/loci/releases'
const RELEASES_API_URL = 'https://api.github.com/repos/bosens-China/loci/releases?per_page=30'
const TIMEOUT_MS = 5_000

interface UpdateCache {
  checkedOn?: string
  checkedAt?: string
  latestVersion?: string
}

interface GitHubRelease {
  tag_name?: unknown
  draft?: unknown
  prerelease?: unknown
}

export interface AppUpdater {
  getState: () => DesktopUpdateState
  check: (force?: boolean) => Promise<DesktopUpdateState>
  openRelease: () => Promise<void>
}

/** 桌面端仅检查并跳转下载，不接管各平台的安装流程。 */
export function createAppUpdater(): AppUpdater {
  const currentVersion = app.getVersion()
  const path = join(app.getPath('userData'), CACHE_FILE)
  let cache = readCache(path)

  const getState = (): DesktopUpdateState => ({
    currentVersion,
    latestVersion: cache.latestVersion ?? null,
    updateAvailable: Boolean(
      cache.latestVersion && isNewerVersion(cache.latestVersion, currentVersion)
    ),
    checkedAt: cache.checkedAt ?? null,
    manualInstallHint:
      process.platform === 'darwin'
        ? 'macOS 版本需要手动下载 DMG；未签名应用首次打开可能需要在“隐私与安全性”中点击“仍要打开”。'
        : null
  })

  return {
    getState,
    check: async (force = true): Promise<DesktopUpdateState> => {
      if (!force && cache.checkedOn === today()) return getState()
      cache = { ...cache, checkedOn: today() }
      writeCache(path, cache)

      const latestVersion = await fetchLatestDesktopVersion()
      cache = { ...cache, checkedAt: new Date().toISOString(), latestVersion }
      writeCache(path, cache)
      return getState()
    },
    openRelease: () =>
      shell.openExternal(
        cache.latestVersion ? `${RELEASES_URL}/tag/loci-v${cache.latestVersion}` : RELEASES_URL
      )
  }
}

export async function fetchLatestDesktopVersion(fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(RELEASES_API_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`检查更新失败：GitHub 返回 ${response.status}`)
  const latestVersion = findLatestDesktopVersion(await response.json())
  if (!latestVersion) throw new Error('未找到桌面端发布版本')
  return latestVersion
}

export function findLatestDesktopVersion(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  for (const release of value) {
    if (!release || typeof release !== 'object' || Array.isArray(release)) continue
    const { tag_name: tagName, draft, prerelease } = release as GitHubRelease
    const version =
      typeof tagName === 'string' ? /^loci-v(\d+\.\d+\.\d+)$/.exec(tagName)?.[1] : null
    if (version && draft !== true && prerelease !== true) return version
  }
  return null
}

function readCache(path: string): UpdateCache {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as UpdateCache) : {}
  } catch {
    return {}
  }
}

function writeCache(path: string, cache: UpdateCache): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(cache)}\n`)
}

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
