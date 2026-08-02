import { describe, expect, it } from 'vitest'
import { isPublicAddress } from './public-fetch.js'

describe('isPublicAddress', () => {
  it('拦截本机和局域网地址', () => {
    expect(isPublicAddress('127.0.0.1')).toBe(false)
    expect(isPublicAddress('10.0.0.1')).toBe(false)
    expect(isPublicAddress('192.168.1.1')).toBe(false)
    expect(isPublicAddress('::1')).toBe(false)
    expect(isPublicAddress('fd00::1')).toBe(false)
  })

  it('允许公网地址', () => {
    expect(isPublicAddress('1.1.1.1')).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
  })
})
