import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from '@/api/client'
import { authenticateSession, readLaunchToken } from '@/api/session'

vi.mock('@/api/client', () => ({
  request: {
    get: vi.fn(),
    post: vi.fn()
  }
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', {
    location: {
      hash: '#token=dev-token',
      pathname: '/',
      search: ''
    },
    history: {
      replaceState: vi.fn()
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('启动会话', () => {
  it('从 URL fragment 读取一次性令牌', () => {
    expect(readLaunchToken('#token=a%20b')).toBe('a b')
  })

  it('没有令牌时返回 null', () => {
    expect(readLaunchToken('')).toBeNull()
  })

  it('复用并发的会话初始化请求', async () => {
    let resolveExchange: (() => void) | undefined
    const exchange = new Promise<void>((resolve) => {
      resolveExchange = resolve
    })
    vi.mocked(request.post).mockImplementation(() => exchange as never)

    const first = authenticateSession()
    const second = authenticateSession()

    expect(second).toBe(first)
    expect(request.post).toHaveBeenCalledOnce()
    resolveExchange?.()
    await Promise.all([first, second])
    expect(window.history.replaceState).toHaveBeenCalledOnce()
  })

  it('完成后释放请求并校验已有会话', async () => {
    vi.mocked(request.post).mockResolvedValue({} as never)
    vi.mocked(request.get).mockResolvedValue({} as never)

    await authenticateSession()
    window.location.hash = ''
    await authenticateSession()

    expect(request.post).toHaveBeenCalledOnce()
    expect(request.get).toHaveBeenCalledOnce()
  })

  it('失败后释放请求并允许重试', async () => {
    vi.mocked(request.post)
      .mockRejectedValueOnce(new Error('会话交换失败'))
      .mockResolvedValueOnce({} as never)

    await expect(authenticateSession()).rejects.toThrow('会话交换失败')
    await expect(authenticateSession()).resolves.toBeUndefined()

    expect(request.post).toHaveBeenCalledTimes(2)
  })
})
