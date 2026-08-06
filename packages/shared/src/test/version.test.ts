import { describe, expect, it } from 'vitest'
import { isNewerVersion } from '../version.js'

describe('isNewerVersion', () => {
  it('按 SemVer 比较正式版本', () => {
    expect(isNewerVersion('1.10.0', '1.9.9')).toBe(true)
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false)
    expect(isNewerVersion('1.2.2', '1.2.3')).toBe(false)
  })

  it('支持 v 前缀并拒绝非法版本', () => {
    expect(isNewerVersion('v2.0.0', 'v1.9.0')).toBe(true)
    expect(isNewerVersion('latest', '1.0.0')).toBe(false)
  })

  it('遵循预发布版本规则', () => {
    expect(isNewerVersion('1.0.0', '1.0.0-beta.1')).toBe(true)
    expect(isNewerVersion('1.0.0-beta.2', '1.0.0-beta.1')).toBe(true)
  })
})
