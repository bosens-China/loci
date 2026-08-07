import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram, runCli } from '../../cli.js'
import { createCliRuntime } from '../../runtime.js'

const originalDataDir = process.env.LOCI_DATA_DIR
const originalCacheDir = process.env.LOCI_CACHE_DIR
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'loci-mcp-config-'))
  process.env.LOCI_DATA_DIR = dataDir
  process.env.LOCI_CACHE_DIR = dataDir
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dataDir, { recursive: true, force: true })
  if (originalDataDir === undefined) delete process.env.LOCI_DATA_DIR
  else process.env.LOCI_DATA_DIR = originalDataDir
  if (originalCacheDir === undefined) delete process.env.LOCI_CACHE_DIR
  else process.env.LOCI_CACHE_DIR = originalCacheDir
})

describe('MCP 手动配置', () => {
  it('默认输出可复制的 stdio mcpServers JSON', async () => {
    let output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await createProgram().parseAsync(['mcp', 'config'], { from: 'user' })

    expect(JSON.parse(output)).toEqual({
      mcpServers: {
        loci: { command: 'loci', args: ['mcp', 'stdio'] }
      }
    })
  })

  it('HTTP 配置读取共享设置中的实际端口', async () => {
    const runtime = createCliRuntime()
    const settings = runtime.database.getSettings()
    runtime.database.saveSettings({ ...settings, mcpPort: 41234 })
    await runtime.close()
    let output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await createProgram().parseAsync(['mcp', 'config', '--transport', 'http'], { from: 'user' })

    expect(JSON.parse(output)).toEqual({
      mcpServers: {
        loci: { url: 'http://127.0.0.1:41234/mcp' }
      }
    })
  })

  it('按客户端输出对应配置，并让 Antigravity 默认使用 HTTP', async () => {
    let output = ''
    let hint = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      hint += String(chunk)
      return true
    })

    await createProgram().parseAsync(['mcp', 'config', 'antigravity'], { from: 'user' })

    expect(JSON.parse(output)).toEqual({
      mcpServers: {
        loci: { serverUrl: 'http://127.0.0.1:37373/mcp' }
      }
    })
    expect(hint).toContain('Google Antigravity')
    expect(hint).toContain('~/.gemini/config/mcp_config.json')
  })

  it('Codex 配置默认输出 CLI stdio TOML', async () => {
    let output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await createProgram().parseAsync(['mcp', 'config', 'codex'], { from: 'user' })

    expect(output.trim()).toBe('[mcp_servers.loci]\ncommand = "loci"\nargs = ["mcp", "stdio"]')
  })

  it('拒绝客户端不支持的传输方式', async () => {
    await expect(
      createProgram().parseAsync(['mcp', 'config', 'antigravity', '--transport', 'stdio'], {
        from: 'user'
      })
    ).rejects.toThrow('Google Antigravity 不支持 stdio 传输')
  })

  it('不再接受 Gemini CLI 配置目标', async () => {
    await expect(
      createProgram().parseAsync(['mcp', 'config', 'gemini-cli'], { from: 'user' })
    ).rejects.toThrow('不支持的 MCP 配置目标：gemini-cli')
  })

  it('存在更新提示缓存时仍保持标准输出为纯 JSON', async () => {
    writeFileSync(
      join(dataDir, 'cli-update.json'),
      `${JSON.stringify({ latestVersion: '99.0.0' })}\n`,
      'utf8'
    )
    let output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runCli(['mcp', 'config'])

    expect(() => JSON.parse(output)).not.toThrow()
    expect(JSON.parse(output)).toHaveProperty('mcpServers.loci.command', 'loci')
  })
})
