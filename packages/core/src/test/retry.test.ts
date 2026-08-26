import { beforeEach, describe, expect, it, vi } from 'vitest'

const { wait } = vi.hoisted(() => ({ wait: vi.fn() }))

vi.mock('node:timers/promises', () => ({ setTimeout: wait }))

import { fetchWithRetry, retryAfterMs } from '../retry.js'

describe('retry', () => {
  beforeEach(() => {
    wait.mockReset().mockImplementation(
      (_milliseconds: number, _value: unknown, options: { signal?: AbortSignal } = {}) =>
        new Promise<void>((_resolve, reject) => {
          const signal = options.signal
          if (signal?.aborted) {
            reject(signal.reason)
            return
          }
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
  })

  it('限制服务端 Retry-After 的最长等待时间', () => {
    expect(retryAfterMs('3600')).toBe(60_000)
    expect(retryAfterMs('-1')).toBe(0)
    expect(retryAfterMs('invalid')).toBe(0)
  })

  it('默认等待把 signal 传给底层 timer 并在取消后停止重试', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 429, headers: { 'retry-after': '3600' } })
    )
    const running = fetchWithRetry('https://example.com', {
      fetchImpl,
      maxRetries: 1,
      signal: controller.signal
    })

    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce())
    expect(wait).toHaveBeenCalledWith(60_000, undefined, { signal: controller.signal })
    controller.abort(new Error('停止等待'))

    await expect(running).rejects.toThrow('停止等待')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('重试前释放上一次响应正文', async () => {
    const cancel = vi.fn(async () => undefined)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 503, headers: new Headers(), body: { cancel } })
      .mockResolvedValueOnce(new Response('ok'))

    await expect(
      fetchWithRetry('https://example.com', {
        fetchImpl,
        maxRetries: 1,
        sleep: async () => undefined
      })
    ).resolves.toBeInstanceOf(Response)
    expect(cancel).toHaveBeenCalledOnce()
  })
})
