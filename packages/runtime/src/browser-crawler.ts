import { spawn } from 'node:child_process'
import { accessSync, constants, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import {
  isAllowedNavigation,
  normalizeUrl,
  parsePage,
  waitForStableContent,
  type CrawledPage,
  type RenderedPageRequest
} from '@loci/core'

type PlaywrightModule = typeof import('playwright-core')
type Browser = Awaited<ReturnType<PlaywrightModule['chromium']['launch']>>
type PlaywrightRegistryBundle = {
  registry: {
    registry: {
      findExecutable(name: string): { executablePath(): string } | undefined
    }
  }
}
export type BrowserInstallPrompt = (install: () => Promise<void>) => Promise<void>

export interface BrowserCommandProgress {
  progress: number | null
  message: string
}

const require = createRequire(import.meta.url)
const HEADLESS_SHELL = 'chromium-headless-shell'

/** 本地运行时统一使用 Playwright 执行浏览器抓取。 */
export class LocalBrowserCrawler {
  private browser: Browser | undefined
  private browserPromise: Promise<Browser> | undefined
  private closePromise: Promise<void> | undefined

  constructor(
    private readonly browsersPath: string,
    private readonly installBrowser: () => Promise<void> = () =>
      runBrowserCommand(browsersPath, 'install')
  ) {}

  async fetchPage(url: string, request: RenderedPageRequest = {}): Promise<CrawledPage> {
    request.signal?.throwIfAborted()
    const browser = await this.getBrowser()
    const context = await browser.newContext({ acceptDownloads: false })
    const page = await context.newPage()
    const abort = (): void => {
      void context.close().catch(() => undefined)
    }
    request.signal?.addEventListener('abort', abort, { once: true })
    const timeout = 30_000
    page.setDefaultTimeout(timeout)
    page.setDefaultNavigationTimeout(timeout)
    page.on('popup', (popup) => void popup.close())
    await page.route('**/*', async (route) => {
      const current = route.request()
      if (
        current.isNavigationRequest() &&
        current.frame() === page.mainFrame() &&
        !isAllowedNavigation(current.url(), request.hostname, request.scopePath)
      ) {
        await route.abort('blockedbyclient')
        return
      }
      await route.continue()
    })

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
      const status = response?.status() ?? 200
      if (status >= 200 && status < 300) {
        await waitForStableContent(
          async () => page.evaluate(() => document.body?.innerText ?? ''),
          { isIdle: () => Promise.resolve(true), signal: request.signal }
        )
      }
      request.signal?.throwIfAborted()
      const finalUrl = normalizeUrl(page.url() || url)
      return {
        url: finalUrl,
        status,
        retryAfter: response?.headers()['retry-after'] ?? null,
        ...(status >= 200 && status < 300
          ? { page: parsePage(await page.content(), finalUrl) }
          : {})
      }
    } finally {
      request.signal?.removeEventListener('abort', abort)
      await context.close().catch(() => undefined)
    }
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closePromise = this.closeCurrentBrowser().finally(() => {
      this.closePromise = undefined
    })
    return this.closePromise
  }

  async ensureInstalled(onMissing?: BrowserInstallPrompt): Promise<void> {
    await ensureBrowserInstalled(this.browsersPath, onMissing, this.installBrowser)
  }

  /** 只检查本地安装文件，不启动 Chromium。 */
  isInstalled(): boolean {
    return browserInstallationStatus(this.browsersPath).installed
  }

  private async getBrowser(): Promise<Browser> {
    if (this.closePromise) await this.closePromise
    if (this.browser) return this.browser
    if (this.browserPromise) return this.browserPromise
    configureBrowserPath(this.browsersPath)
    const launch = launchHeadlessShell()
      .then(async (browser) => {
        if (this.closePromise) {
          await browser.close().catch(() => undefined)
          throw new Error('浏览器正在关闭')
        }
        this.browser = browser
        return browser
      })
      .catch((error: unknown) => {
        throw new Error(
          `无法启动无头浏览器：${error instanceof Error ? error.message : '未知错误'}\n请先运行 loci browser install。`
        )
      })
      .finally(() => {
        if (this.browserPromise === launch) this.browserPromise = undefined
      })
    this.browserPromise = launch
    return launch
  }

  private async closeCurrentBrowser(): Promise<void> {
    const browser = this.browser ?? (await this.browserPromise?.catch(() => undefined))
    if (this.browser === browser) this.browser = undefined
    await browser?.close()
  }
}

export async function ensureBrowserInstalled(
  browsersPath: string,
  onMissing?: BrowserInstallPrompt,
  installBrowser: () => Promise<void> = () => runBrowserCommand(browsersPath, 'install')
): Promise<void> {
  configureBrowserPath(browsersPath)
  const executable = resolveHeadlessShellExecutable()
  if (isExecutable(executable)) return
  if (!onMissing) throw new Error('未安装 Chromium headless shell，请先运行 loci browser install。')
  await onMissing(installBrowser)
  if (!isExecutable(executable)) {
    throw new Error('浏览器安装完成，但没有找到 Chromium headless shell 可执行文件。')
  }
}

export async function browserStatus(browsersPath: string): Promise<{
  installed: boolean
  executable: string
  launchable: boolean
  chromiumVersion: string | null
  playwrightVersion: string
  error: string | null
}> {
  const installation = browserInstallationStatus(browsersPath)
  const { installed, executable, playwrightVersion } = installation
  if (!installed) {
    return {
      installed,
      executable,
      launchable: false,
      chromiumVersion: null,
      playwrightVersion,
      error: null
    }
  }
  try {
    const browser = await launchHeadlessShell(executable)
    const chromiumVersion = browser.version()
    await browser.close()
    return {
      installed,
      executable,
      launchable: true,
      chromiumVersion,
      playwrightVersion,
      error: null
    }
  } catch (error) {
    return {
      installed,
      executable,
      launchable: false,
      chromiumVersion: null,
      playwrightVersion,
      error: error instanceof Error ? error.message : '浏览器启动失败'
    }
  }
}

export function browserInstallationStatus(browsersPath: string): {
  installed: boolean
  executable: string
  playwrightVersion: string
} {
  configureBrowserPath(browsersPath)
  const executable = resolveHeadlessShellExecutable()
  const packageFile = require.resolve('playwright-core/package.json')
  const packageInfo = require(packageFile) as { version?: unknown }
  return {
    installed: isExecutable(executable),
    executable,
    playwrightVersion: typeof packageInfo.version === 'string' ? packageInfo.version : 'unknown'
  }
}

export async function runBrowserCommand(
  browsersPath: string,
  command: 'install' | 'uninstall',
  onProgress?: (progress: BrowserCommandProgress) => void
): Promise<void> {
  mkdirSync(browsersPath, { recursive: true })
  const packageFile = require.resolve('playwright-core/package.json')
  const cliFile = join(dirname(packageFile), 'cli.js')
  const args = command === 'install' ? ['install', 'chromium', '--only-shell'] : ['uninstall']
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cliFile, ...args], {
      stdio: onProgress ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath }
    })
    if (onProgress) {
      collectBrowserCommandOutput(child.stdout, onProgress)
      collectBrowserCommandOutput(child.stderr, onProgress)
    }
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`浏览器${command === 'install' ? '安装' : '卸载'}失败`))
    )
  })
}

export function parseBrowserCommandProgress(line: string): BrowserCommandProgress {
  const percentage = /\|\s+(\d{1,3})% of\s+(.+)$/u.exec(line.trim())
  if (percentage) {
    return {
      progress: Math.min(100, Number(percentage[1])),
      message: `正在下载 Chromium headless shell（${percentage[2]}）`
    }
  }
  if (line.includes('Downloading '))
    return { progress: 0, message: '正在下载 Chromium headless shell' }
  if (line.includes('downloaded to '))
    return { progress: 100, message: '下载完成，正在整理安装文件' }
  return { progress: null, message: line.trim() }
}

function collectBrowserCommandOutput(
  stream: Readable | null,
  onProgress: (progress: BrowserCommandProgress) => void
): void {
  if (!stream) return
  let pending = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    pending += chunk
    const lines = pending.split(/[\r\n]+/u)
    pending = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) onProgress(parseBrowserCommandProgress(line))
  })
  stream.on('end', () => {
    if (pending.trim()) onProgress(parseBrowserCommandProgress(pending))
  })
}

function configureBrowserPath(path: string): void {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path
}

/** 使用 Playwright 自身的版本与平台映射解析受管 headless shell。 */
function resolveHeadlessShellExecutable(): string {
  const bundle = require('playwright-core/lib/coreBundle') as PlaywrightRegistryBundle
  const executable = bundle.registry.registry.findExecutable(HEADLESS_SHELL)?.executablePath()
  if (!executable) throw new Error('当前平台不支持 Chromium headless shell。')
  return executable
}

async function launchHeadlessShell(
  executablePath = resolveHeadlessShellExecutable()
): Promise<Browser> {
  const { chromium } = await import('playwright-core')
  return chromium.launch({ headless: true, executablePath })
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
