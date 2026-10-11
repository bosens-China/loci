import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertAllowedBrowserRequest } from '../browser-crawl.js'

vi.mock('playwright-core', () => ({
  chromium: {
    connect: vi.fn(),
    launch: vi.fn()
  }
}))

const publicLookup = async (): Promise<Array<{ address: string; family: 4 }>> => [
  { address: '93.184.216.34', family: 4 }
]
const privateLookup = async (): Promise<Array<{ address: string; family: 4 }>> => [
  { address: '127.0.0.1', family: 4 }
]

beforeEach(() => vi.clearAllMocks())

describe('assertAllowedBrowserRequest', () => {
  it('允许公开子资源，但拒绝私网和跨站导航', async () => {
    await expect(
      assertAllowedBrowserRequest(
        'https://cdn.example.net/app.js',
        'docs.example.com',
        false,
        publicLookup
      )
    ).resolves.toBeUndefined()
    await expect(
      assertAllowedBrowserRequest(
        'https://internal.example/a',
        'docs.example.com',
        false,
        privateLookup
      )
    ).rejects.toThrow()
    await expect(
      assertAllowedBrowserRequest('https://other.example/a', 'docs.example.com', true, publicLookup)
    ).rejects.toThrow()
  })
})
