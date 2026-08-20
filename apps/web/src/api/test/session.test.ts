import { describe, expect, it } from 'vitest'
import { readLaunchToken } from '@/api/session'

describe('启动会话', () => {
  it('从 URL fragment 读取一次性令牌', () => {
    expect(readLaunchToken('#token=a%20b')).toBe('a b')
  })

  it('没有令牌时返回 null', () => {
    expect(readLaunchToken('')).toBeNull()
  })
})
