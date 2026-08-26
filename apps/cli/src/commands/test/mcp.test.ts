import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram, runCli } from '../../cli.js'

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

describe('Agent MCP 配置', () => {
  it('完整命令输出可复制的 stdio mcpServers JSON', async () => {
    let output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await createProgram().parseAsync(['agent', 'print-config', 'generic'], {
      from: 'user'
    })

    expect(JSON.parse(output)).toEqual({
      mcpServers: {
        loci: { command: 'loci', args: ['mcp', 'stdio'] }
      }
    })
  })

  it('Codex 配置输出 CLI stdio TOML', async () => {
    let output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await createProgram().parseAsync(['agent', 'print-config', 'codex'], {
      from: 'user'
    })

    expect(output.trim()).toBe('[mcp_servers.loci]\ncommand = "loci"\nargs = ["mcp", "stdio"]')
  })

  it('不再接受 Gemini CLI 配置目标', async () => {
    await expect(
      createProgram().parseAsync(['agent', 'print-config', 'gemini-cli'], { from: 'user' })
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

    await runCli(['agent', 'print-config', 'generic'])

    expect(() => JSON.parse(output)).not.toThrow()
    expect(JSON.parse(output)).toHaveProperty('mcpServers.loci.command', 'loci')
  })

  it('Cursor 全局规则输出受管区块', async () => {
    let output = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk)
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await createProgram().parseAsync(['agent', 'rules', 'cursor'], { from: 'user' })

    expect(output).toContain('<!-- loci:start -->')
    expect(output).toContain('<!-- loci:end -->')
  })

  it('全局规则命令拒绝未知客户端和非交互省略值', async () => {
    await expect(
      createProgram().parseAsync(['agent', 'rules', 'unknown'], { from: 'user' })
    ).rejects.toThrow('不支持的 Agent 客户端')
    await expect(createProgram().parseAsync(['agent', 'rules'], { from: 'user' })).rejects.toThrow(
      '非交互终端必须指定'
    )
  })

  it('非交互模式拒绝根命令和不完整子命令', async () => {
    await expect(createProgram().parseAsync(['agent'], { from: 'user' })).rejects.toThrow(
      '请使用完整的 loci agent 子命令和参数'
    )
    await expect(
      createProgram().parseAsync(['agent', 'connect', 'codex'], { from: 'user' })
    ).rejects.toThrow('非交互写入 Agent 配置必须传入 --yes')
  })
})
