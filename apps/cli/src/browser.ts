import { join } from 'node:path'
import type { BrowserOperationStatus } from '@loci/shared'
import {
  BrowserManager,
  hasActiveCrawlLocks,
  resolveLociCacheDir,
  resolveLociDataDir
} from '@loci/runtime'

export {
  LocalBrowserCrawler as CliBrowserCrawler,
  browserStatus,
  ensureBrowserInstalled,
  runBrowserCommand,
  type BrowserInstallPrompt
} from '@loci/runtime'

export function createCliBrowserManager(
  onChange?: (status: BrowserOperationStatus) => void
): BrowserManager {
  const cacheDir = resolveLociCacheDir()
  const dataDir = resolveLociDataDir()
  return new BrowserManager({
    browsersPath: join(cacheDir, 'playwright'),
    lockRoot: cacheDir,
    usageLockRoot: dataDir,
    owner: 'CLI ',
    onChange,
    assertCanUninstall: () => {
      if (hasActiveCrawlLocks(dataDir)) {
        throw new Error('仍有文档抓取任务正在使用浏览器，请等待完成后重试')
      }
    }
  })
}
