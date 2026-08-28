import { createRequire } from 'node:module'
import type { ServerBrowserStatus } from '@loci/shared'
import { chromium } from 'playwright-core'
import type { BrowserConfig } from './browser-config.js'

const require = createRequire(import.meta.url)

/** Admin 诊断只返回脱敏后的提供方信息，不暴露 Browserless 令牌。 */
export async function checkServerBrowserStatus(
  config: BrowserConfig | undefined
): Promise<ServerBrowserStatus> {
  const checkedAt = new Date().toISOString()
  const playwrightVersion = readPlaywrightVersion()
  if (!config) {
    return {
      provider: 'disabled',
      available: false,
      chromiumVersion: null,
      playwrightVersion,
      endpoint: null,
      checkedAt,
      error: null
    }
  }

  try {
    const browser =
      config.provider === 'local'
        ? await chromium.launch({ headless: true, timeout: 10_000 })
        : await chromium.connect(config.endpoint, { timeout: 10_000 })
    const chromiumVersion = browser.version()
    await browser.close()
    return {
      provider: config.provider,
      available: true,
      chromiumVersion,
      playwrightVersion,
      endpoint: config.provider === 'browserless' ? redactEndpoint(config.endpoint) : null,
      checkedAt,
      error: null
    }
  } catch {
    return {
      provider: config.provider,
      available: false,
      chromiumVersion: null,
      playwrightVersion,
      endpoint: config.provider === 'browserless' ? redactEndpoint(config.endpoint) : null,
      checkedAt,
      error:
        config.provider === 'local'
          ? '无法启动镜像内的 Chromium headless shell'
          : '无法连接 Browserless 浏览器服务'
    }
  }
}

function redactEndpoint(input: string): string {
  const endpoint = new URL(input)
  endpoint.username = ''
  endpoint.password = ''
  endpoint.search = ''
  endpoint.hash = ''
  return endpoint.toString()
}

function readPlaywrightVersion(): string {
  const packageInfo = require('playwright-core/package.json') as { version?: unknown }
  return typeof packageInfo.version === 'string' ? packageInfo.version : 'unknown'
}
