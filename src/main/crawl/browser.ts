import { BrowserWindow, session, type Session } from 'electron'
import { isRetryableStatus, retryAfterMs } from './fetch'
import { isAllowedNavigation } from './url'

export interface RenderedPage {
  url: string
  html: string
  status: number
  retryAfter: string | null
}

export interface RenderedFetchOptions {
  timeoutMs?: number
  maxRetries?: number
  hostname?: string
  sleep?: (milliseconds: number) => Promise<void>
}

interface MainFrameResponse {
  status: number
  retryAfter: string | null
}

let isolatedSession: Session | undefined
const responses = new Map<number, MainFrameResponse>()

// 所有远程页面共用独立的内存 Session，与应用窗口的 Cookie、权限和下载完全隔离。
function getIsolatedSession(): Session {
  if (isolatedSession) return isolatedSession
  isolatedSession = session.fromPartition('doc-hub-crawler')
  isolatedSession.setPermissionCheckHandler(() => false)
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  isolatedSession.on('will-download', (event) => event.preventDefault())
  isolatedSession.webRequest.onResponseStarted(
    { urls: ['http://*/*', 'https://*/*'] },
    (details) => {
      if (details.resourceType !== 'mainFrame' || details.webContentsId === undefined) return
      responses.set(details.webContentsId, {
        status: details.statusCode,
        retryAfter: findHeader(details.responseHeaders, 'retry-after')
      })
    }
  )
  return isolatedSession
}

export async function fetchRenderedPage(
  url: string,
  options: RenderedFetchOptions = {}
): Promise<RenderedPage> {
  const maxRetries = options.maxRetries ?? 3
  const sleep =
    options.sleep ??
    ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const page = await fetchRenderedPageOnce(url, options)
      if (!isRetryableStatus(page.status) || attempt === maxRetries) return page
      await sleep(retryAfterMs(page.retryAfter))
    } catch (error) {
      if (attempt === maxRetries) throw error
      await sleep(0)
    }
  }
  throw new Error('浏览器抓取任务未返回结果')
}

async function fetchRenderedPageOnce(
  url: string,
  options: RenderedFetchOptions
): Promise<RenderedPage> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: getIsolatedSession(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  const webContentsId = window.webContents.id
  responses.delete(webContentsId)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => {
    if (!isAllowedNavigation(event.url, options.hostname)) event.preventDefault()
  })
  window.webContents.on('will-redirect', (event) => {
    if (!isAllowedNavigation(event.url, options.hostname)) event.preventDefault()
  })

  try {
    return await withTimeout(
      (async () => {
        try {
          await window.loadURL(url)
        } catch (error) {
          if (!responses.has(webContentsId)) throw error
        }
        const response = responses.get(webContentsId)
        const status = response?.status ?? 200
        if (status >= 200 && status < 300) await waitForStableContent(window)
        const html =
          status >= 200 && status < 300
            ? String(
                await window.webContents.executeJavaScript(
                  'document.documentElement.outerHTML',
                  true
                )
              )
            : ''
        return {
          url: window.webContents.getURL() || url,
          html,
          status,
          retryAfter: response?.retryAfter ?? null
        }
      })(),
      options.timeoutMs ?? 30_000
    )
  } finally {
    responses.delete(webContentsId)
    if (!window.isDestroyed()) window.destroy()
  }
}

async function waitForStableContent(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      let previous = ''
      let stableChecks = 0
      const deadline = Date.now() + 3000
      const check = () => {
        const current = document.body?.innerText ?? ''
        stableChecks = current === previous ? stableChecks + 1 : 0
        previous = current
        if (stableChecks >= 2 || Date.now() >= deadline) resolve(true)
        else setTimeout(check, 250)
      }
      check()
    })
  `)
}

function findHeader(headers: Record<string, string[]> | undefined, name: string): string | null {
  if (!headers) return null
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name)
  return entry?.[1]?.[0] ?? null
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('浏览器抓取超时')), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
