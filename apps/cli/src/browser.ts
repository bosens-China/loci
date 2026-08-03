import { accessSync, constants, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import {
  isAllowedNavigation,
  normalizeUrl,
  parsePage,
  waitForStableContent,
  type CrawledPage,
  type RenderedPageRequest
} from '@loci/core'
import { CliError } from './errors.js'

type PlaywrightModule = typeof import('playwright-core')
type Browser = Awaited<ReturnType<PlaywrightModule['chromium']['launch']>>

export class CliBrowserCrawler {
  private browser: Browser | undefined

  constructor(private readonly browsersPath: string) {}

  async fetchPage(url: string, request: RenderedPageRequest = {}): Promise<CrawledPage> {
    const browser = await this.getBrowser()
    const context = await browser.newContext({ acceptDownloads: false })
    const page = await context.newPage()
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
          { isIdle: () => Promise.resolve(true) }
        )
      }
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
      await context.close()
    }
  }

  async close(): Promise<void> {
    await this.browser?.close()
    this.browser = undefined
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser) return this.browser
    configureBrowserPath(this.browsersPath)
    try {
      const { chromium } = await import('playwright-core')
      this.browser = await chromium.launch({ headless: true })
      return this.browser
    } catch (error) {
      throw new CliError(
        `无法启动无头浏览器：${error instanceof Error ? error.message : '未知错误'}\n请先运行 loci browser install。`
      )
    }
  }
}

export async function browserStatus(browsersPath: string): Promise<{
  installed: boolean
  executable: string
  launchable: boolean
  error: string | null
}> {
  configureBrowserPath(browsersPath)
  const { chromium } = await import('playwright-core')
  const executable = chromium.executablePath()
  let installed = true
  try {
    accessSync(executable, constants.X_OK)
  } catch {
    installed = false
  }
  if (!installed) return { installed, executable, launchable: false, error: null }
  try {
    const browser = await chromium.launch({ headless: true })
    await browser.close()
    return { installed, executable, launchable: true, error: null }
  } catch (error) {
    return {
      installed,
      executable,
      launchable: false,
      error: error instanceof Error ? error.message : '浏览器启动失败'
    }
  }
}

export async function runBrowserCommand(
  browsersPath: string,
  command: 'install' | 'uninstall'
): Promise<void> {
  mkdirSync(browsersPath, { recursive: true })
  const require = createRequire(import.meta.url)
  const packageFile = require.resolve('playwright-core/package.json')
  const cliFile = join(dirname(packageFile), 'cli.js')
  const args = command === 'install' ? ['install', 'chromium', '--only-shell'] : ['uninstall']
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cliFile, ...args], {
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath }
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new CliError(`浏览器${command === 'install' ? '安装' : '卸载'}失败`))
    )
  })
}

function configureBrowserPath(path: string): void {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path
}
