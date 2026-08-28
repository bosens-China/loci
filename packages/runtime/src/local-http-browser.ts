import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LocalRuntime } from './local-runtime.js'
import { json, mutationJson } from './local-http-response.js'

/** 本机浏览器管理 API 只启动 Runtime 操作；进度由后续 GET 轮询读取。 */
export async function handleLocalBrowser(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/api/browser') {
    json(response, 200, await runtime.browserManager.getStatus())
    return true
  }
  if (request.method === 'POST' && url.pathname === '/api/browser/install') {
    await mutationJson(response, 202, async () => {
      runtime.browserManager.start('install')
      return runtime.browserManager.getStatus()
    })
    return true
  }
  if (request.method === 'DELETE' && url.pathname === '/api/browser') {
    await mutationJson(response, 202, async () => {
      runtime.browserManager.start('uninstall')
      return runtime.browserManager.getStatus()
    })
    return true
  }
  return false
}
