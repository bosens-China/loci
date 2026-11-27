import type { IncomingMessage, ServerResponse } from 'node:http'
import { json } from './local-http-response.js'
import {
  checkForCliUpdate,
  readCachedUpdateStatus,
  readRuntimeVersion,
  triggerBackgroundUpdateCheck
} from './update-check.js'

export interface UpdateApiOptions {
  currentVersion?: string
  cacheDir?: string
  fetcher?: typeof fetch
}

/** 本地 Web 更新检查接口：GET 立即返回缓存并异步触发后台检查，POST 立即执行在线检查。 */
export async function handleUpdateApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: UpdateApiOptions = {}
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/api/update') {
    const version = options.currentVersion ?? readRuntimeVersion()
    void triggerBackgroundUpdateCheck(version, {
      cacheDir: options.cacheDir,
      fetcher: options.fetcher
    })
    json(response, 200, readCachedUpdateStatus(version, { cacheDir: options.cacheDir }))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/update/check') {
    const version = options.currentVersion ?? readRuntimeVersion()
    const status = await checkForCliUpdate(version, {
      cacheDir: options.cacheDir,
      fetcher: options.fetcher
    })
    json(response, 200, status)
    return true
  }

  return false
}
