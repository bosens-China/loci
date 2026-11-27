import { describe, expect, it } from 'vitest'
import { shouldNotifyUpdate } from '../update.js'

describe('CLI update notification gating', () => {
  it('交互式终端下裸敲 loci 与常规命令都会触发更新检查和提示', () => {
    expect(shouldNotifyUpdate([], { isTTY: true, env: {} })).toBe(true)
    expect(shouldNotifyUpdate(['list'], { isTTY: true, env: {} })).toBe(true)
    expect(shouldNotifyUpdate(['--help'], { isTTY: true, env: {} })).toBe(true)
  })

  it('在非 TTY、--json、upgrade、版本查询或禁用环境变量下跳过', () => {
    expect(shouldNotifyUpdate([], { isTTY: false, env: {} })).toBe(false)
    expect(shouldNotifyUpdate(['list', '--json'], { isTTY: true, env: {} })).toBe(false)
    expect(shouldNotifyUpdate(['upgrade'], { isTTY: true, env: {} })).toBe(false)
    expect(shouldNotifyUpdate(['--version'], { isTTY: true, env: {} })).toBe(false)
    expect(shouldNotifyUpdate(['-V'], { isTTY: true, env: {} })).toBe(false)
    expect(shouldNotifyUpdate(['__crawl'], { isTTY: true, env: {} })).toBe(false)
    expect(shouldNotifyUpdate(['list'], { isTTY: true, env: { CI: 'true' } })).toBe(false)
    expect(shouldNotifyUpdate(['list'], { isTTY: true, env: { LOCI_NO_UPDATE_CHECK: '1' } })).toBe(
      false
    )
  })
})
