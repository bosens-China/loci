import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, shell } from 'electron'
import { isNewerVersion } from '@loci/shared'
import type { DesktopUpdateState } from '@loci/shared'
import type { AppUpdater as ElectronAutoUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'

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

interface AppUpdaterOptions {
  platform?: NodeJS.Platform
  currentVersion?: string
  cachePath?: string
  fetcher?: typeof fetch
  loadAutoUpdater?: () => Promise<ElectronAutoUpdater>
}

/** Windows/Linux 自动下载并在退出时安装；macOS 保持手动安装。 */
export function createAppUpdater(options: AppUpdaterOptions = {}): AppUpdater {
  const platform = options.platform ?? process.platform
  const currentVersion = options.currentVersion ?? app.getVersion()
  const path = options.cachePath ?? join(app.getPath('userData'), CACHE_FILE)
  const fetcher = options.fetcher ?? fetch
  const autoUpdateSupported = platform === 'win32' || platform === 'linux'
  let cache = readCache(path)
  let status: DesktopUpdateState['status'] = 'idle'
  let downloadProgress: number | null = null
  let error: string | null = null
  let checking: Promise<DesktopUpdateState> | undefined
  let automaticUpdater: Promise<ElectronAutoUpdater> | undefined

  const getState = (): DesktopUpdateState => ({
    currentVersion,
    latestVersion: cache.latestVersion ?? null,
    updateAvailable: Boolean(
      cache.latestVersion && isNewerVersion(cache.latestVersion, currentVersion)
    ),
    checkedAt: cache.checkedAt ?? null,
    autoUpdateSupported,
    status,
    downloadProgress,
    error,
    manualInstallHint:
      platform === 'darwin'
        ? 'macOS 版本需要手动下载 DMG；未签名应用首次打开可能需要在“隐私与安全性”中点击“仍要打开”。'
        : null
  })

  const getAutomaticUpdater = (): Promise<ElectronAutoUpdater> => {
    automaticUpdater ??= (
      options.loadAutoUpdater?.() ?? import('electron-updater').then((it) => it.autoUpdater)
    ).then((updater) => {
      updater.allowPrerelease = false
      updater.autoDownload = true
      updater.autoInstallOnAppQuit = true
      updater.on('checking-for-update', () => {
        status = 'checking'
        error = null
      })
      updater.on('update-available', (info: UpdateInfo) => {
        saveLatestVersion(info.version)
        status = 'downloading'
      })
      updater.on('update-not-available', (info: UpdateInfo) => {
        saveLatestVersion(info.version)
        status = 'idle'
        downloadProgress = null
      })
      updater.on('download-progress', (progress: ProgressInfo) => {
        status = 'downloading'
        downloadProgress = Math.round(progress.percent)
      })
      updater.on('update-downloaded', (info: UpdateInfo) => {
        saveLatestVersion(info.version)
        status = 'ready'
        downloadProgress = 100
      })
      updater.on('error', (reason: Error) => {
        status = 'error'
        error = reason.message
      })
      return updater
    })
    return automaticUpdater
  }

  const saveLatestVersion = (latestVersion: string): void => {
    cache = { ...cache, latestVersion }
    writeCache(path, cache)
  }

  const runCheck = async (): Promise<DesktopUpdateState> => {
    cache = { ...cache, checkedOn: today() }
    writeCache(path, cache)
    status = 'checking'
    error = null

    try {
      const latestVersion = await fetchLatestDesktopVersion(fetcher)
      cache = { ...cache, checkedAt: new Date().toISOString(), latestVersion }
      writeCache(path, cache)

      if (autoUpdateSupported && isNewerVersion(latestVersion, currentVersion)) {
        const updater = await getAutomaticUpdater()
        updater.setFeedURL({
          provider: 'generic',
          url: `${RELEASES_URL}/download/loci-v${latestVersion}`
        })
        await updater.checkForUpdatesAndNotify({
          title: 'Loci 更新已下载',
          body: 'Loci {version} 已下载，将在退出应用后自动安装。'
        })
      } else {
        status = 'idle'
      }
      return getState()
    } catch (reason) {
      status = 'error'
      error = reason instanceof Error ? reason.message : '检查更新失败'
      throw reason
    }
  }

  return {
    getState,
    check: (force = true): Promise<DesktopUpdateState> => {
      if (checking) return checking
      if (status === 'downloading' || status === 'ready') return Promise.resolve(getState())
      if (!force && cache.checkedOn === today()) return Promise.resolve(getState())
      checking = runCheck().finally(() => {
        checking = undefined
      })
      return checking
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
