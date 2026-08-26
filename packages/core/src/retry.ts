import { setTimeout as wait } from 'node:timers/promises'
import { abortableSleep, throwIfAborted } from './abort.js'
import type { FetchOptions } from './types.js'

const MAX_RETRY_AFTER_MS = 60_000

export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const maxRetries = options.maxRetries ?? 3
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    throwIfAborted(options.signal)
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const response = await fetchImpl(url, {
        signal: options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal,
        redirect: 'follow'
      })
      if (!isRetryableStatus(response.status) || attempt === maxRetries) return response
      await response.body?.cancel().catch(() => undefined)
      await abortableSleep(retryAfterMs(response.headers.get('retry-after')), options.signal, sleep)
    } catch (error) {
      throwIfAborted(options.signal)
      if (attempt === maxRetries) throw error
      await abortableSleep(0, options.signal, sleep)
    }
  }
  throw new Error('抓取任务未返回结果')
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export function retryAfterMs(value: string | null): number {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return clampRetryAfter(seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? clampRetryAfter(date - Date.now()) : 0
}

function clampRetryAfter(milliseconds: number): number {
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, milliseconds))
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return wait(milliseconds, undefined, { signal })
}
