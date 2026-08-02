import { describe, expect, it } from 'vitest'
import { assertAllowedBrowserRequest } from './browser-crawl.js'

const publicLookup = async (): Promise<Array<{ address: string; family: 4 }>> => [
  { address: '93.184.216.34', family: 4 }
]
const privateLookup = async (): Promise<Array<{ address: string; family: 4 }>> => [
  { address: '127.0.0.1', family: 4 }
]

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
    ).rejects.toThrow('不允许抓取')
    await expect(
      assertAllowedBrowserRequest('https://other.example/a', 'docs.example.com', true, publicLookup)
    ).rejects.toThrow('超出了文档库范围')
  })
})
