import { describe, expect, it, vi } from 'vitest'
import { fetchWithRetry, isRetryableStatus } from './fetch'

describe('fetchWithRetry', () => {
  it('retries transient responses and returns the eventual response', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const response = await fetchWithRetry('https://example.com', {
      fetchImpl,
      sleep: async () => undefined
    })

    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not retry ordinary client errors', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('missing', { status: 404 }))
    const response = await fetchWithRetry('https://example.com', { fetchImpl })
    expect(response.status).toBe(404)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('recognizes the PRD retry statuses', () => {
    expect(isRetryableStatus(408)).toBe(true)
    expect(isRetryableStatus(429)).toBe(true)
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(404)).toBe(false)
  })
})
