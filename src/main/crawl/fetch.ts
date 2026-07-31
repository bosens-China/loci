export interface FetchOptions {
  timeoutMs?: number
  maxRetries?: number
  fetchImpl?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
}

export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const maxRetries = options.maxRetries ?? 3
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep =
    options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' })
        if (!isRetryableStatus(response.status) || attempt === maxRetries) return response
        await sleep(retryAfterMs(response.headers.get('retry-after')))
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      if (attempt === maxRetries) throw error
      await sleep(0)
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
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0
}
