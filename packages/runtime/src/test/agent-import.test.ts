import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import which from 'which'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAgentImportCommand,
  importAgentClient,
  LOCI_CLI_STDIO_CONNECTION
} from '../agent-import.js'
import { acquireRuntimeLock } from '../runtime-lock.js'

vi.mock('which', () => ({ default: vi.fn(async () => null) }))

let root = ''
let homeDir = ''
let dataDir = ''
const originalHome = process.env.HOME

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'loci-agent-import-'))
  homeDir = join(root, 'home')
  dataDir = join(root, 'data')
  mkdirSync(dataDir, { recursive: true })
  process.env.HOME = homeDir
  vi.mocked(which).mockClear()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
})

describe('Agent MCP 导入命令', () => {
  it('为四种客户端生成同名 loci 的 CLI stdio 配置', () => {
    expect(createAgentImportCommand('codex', LOCI_CLI_STDIO_CONNECTION).args).toEqual([
      'mcp',
      'add',
      'loci',
      '--',
      'loci',
      'mcp',
      'stdio'
    ])
    expect(createAgentImportCommand('cursor', LOCI_CLI_STDIO_CONNECTION).args[1]).toBe(
      JSON.stringify({
        name: 'loci',
        type: 'stdio',
        command: 'loci',
        args: ['mcp', 'stdio']
      })
    )
    expect(createAgentImportCommand('vscode', LOCI_CLI_STDIO_CONNECTION).args[1]).toContain(
      '"type":"stdio"'
    )
    expect(createAgentImportCommand('claude-code', LOCI_CLI_STDIO_CONNECTION).args).toEqual([
      'mcp',
      'add',
      '--transport',
      'stdio',
      '--scope',
      'user',
      'loci',
      '--',
      'loci',
      'mcp',
      'stdio'
    ])
  })

  it('区分不支持命令导入与未知客户端', () => {
    expect(() => createAgentImportCommand('antigravity', LOCI_CLI_STDIO_CONNECTION)).toThrow()
    expect(() => createAgentImportCommand('gemini-cli', LOCI_CLI_STDIO_CONNECTION)).toThrow()
  })

  it('客户端命令缺失时回退创建用户配置文件', async () => {
    await importAgentClient('codex', LOCI_CLI_STDIO_CONNECTION, {
      dataDir,
      owner: '测试'
    })
    const content = readFileSync(join(homeDir, '.codex', 'config.toml'), 'utf8')

    expect(content).toContain('[mcp_servers.loci]')
  })

  it('客户端命令返回失败状态时回退用户配置文件', async () => {
    vi.mocked(which).mockResolvedValueOnce(process.execPath)

    await importAgentClient('codex', LOCI_CLI_STDIO_CONNECTION, {
      dataDir,
      owner: '测试'
    })

    expect(readFileSync(join(homeDir, '.codex', 'config.toml'), 'utf8')).toContain(
      '[mcp_servers.loci]'
    )
  })

  it('显式用户目录跳过客户端命令并写入指定位置', async () => {
    vi.mocked(which).mockResolvedValueOnce(process.execPath)

    await importAgentClient('codex', LOCI_CLI_STDIO_CONNECTION, {
      homeDir,
      dataDir,
      owner: '测试'
    })

    expect(which).not.toHaveBeenCalled()
    expect(readFileSync(join(homeDir, '.codex', 'config.toml'), 'utf8')).toContain(
      '[mcp_servers.loci]'
    )
  })

  it('不支持命令的客户端直接写入，并复用同进程并发任务', async () => {
    const [first, second] = await Promise.all(
      [1, 2].map(() =>
        importAgentClient('antigravity', LOCI_CLI_STDIO_CONNECTION, {
          homeDir,
          dataDir,
          owner: '测试'
        })
      )
    )
    const config = JSON.parse(
      readFileSync(join(homeDir, '.gemini', 'config', 'mcp_config.json'), 'utf8')
    )

    expect(first).toEqual(second)
    expect(config).toHaveProperty('mcpServers.loci', {
      command: 'loci',
      args: ['mcp', 'stdio']
    })
    expect(which).not.toHaveBeenCalled()
  })

  it('跨进程锁占用时不并发修改同一客户端配置', async () => {
    const lock = acquireRuntimeLock(dataDir, 'agent-mcp-config-codex', '另一个进程')
    try {
      await expect(
        importAgentClient('codex', LOCI_CLI_STDIO_CONNECTION, {
          dataDir,
          owner: '测试'
        })
      ).rejects.toThrow()
    } finally {
      lock.release()
    }
  })
})
