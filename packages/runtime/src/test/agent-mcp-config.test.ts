import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOCI_CLI_STDIO_CONNECTION } from '../agent-import.js'
import {
  inspectAgentMcpConfigFile,
  removeAgentMcpConfigFile,
  resolveAgentMcpConfigPath,
  writeAgentMcpConfigFile
} from '../agent-mcp-config.js'

let root = ''
let homeDir = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'loci-agent-mcp-config-'))
  homeDir = join(root, 'home')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('Agent MCP 用户配置文件', () => {
  it('文件不存在时创建 Cursor 配置，重复写入保持幂等', () => {
    const first = writeAgentMcpConfigFile('cursor', LOCI_CLI_STDIO_CONNECTION, { homeDir })
    const second = writeAgentMcpConfigFile('cursor', LOCI_CLI_STDIO_CONNECTION, { homeDir })

    expect(first).toMatchObject({ created: true, changed: true })
    expect(second).toMatchObject({ created: false, changed: false })
    expect(JSON.parse(readFileSync(first.path, 'utf8'))).toEqual({
      mcpServers: { loci: { command: 'loci', args: ['mcp', 'stdio'] } }
    })
  })

  it('合并已有 VS Code JSONC 而不删除注释和其他服务', () => {
    const path = resolveAgentMcpConfigPath('vscode', { homeDir, platform: 'linux' })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
      path,
      '{\n  // 用户服务\n  "servers": {\n    "other": { "command": "other" },\n  },\n}\n',
      'utf8'
    )

    writeAgentMcpConfigFile('vscode', LOCI_CLI_STDIO_CONNECTION, {
      homeDir,
      platform: 'linux'
    })
    const content = readFileSync(path, 'utf8')

    expect(content).toContain('// 用户服务')
    expect(content).toContain('"other"')
    expect(content).toContain('"loci"')
  })

  it('替换 Codex loci 表及其子表并保留其他 TOML', () => {
    const path = resolveAgentMcpConfigPath('codex', { homeDir })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
      path,
      [
        'model = "gpt-5"',
        '',
        '[mcp_servers.other]',
        'command = "other"',
        '',
        '[mcp_servers.loci]',
        'url = "http://127.0.0.1:1/mcp"',
        '',
        '[mcp_servers.loci.env]',
        'OLD = "value"',
        '',
        '[projects."/repo"]',
        'trusted = true',
        ''
      ].join('\n'),
      'utf8'
    )

    const result = writeAgentMcpConfigFile('codex', LOCI_CLI_STDIO_CONNECTION, { homeDir })
    const content = readFileSync(path, 'utf8')

    expect(result.changed).toBe(true)
    expect(content).toContain('model = "gpt-5"')
    expect(content).toContain('[mcp_servers.other]')
    expect(content).toContain('[projects."/repo"]')
    expect(content).toContain('command = "loci"')
    expect(content).not.toContain('OLD = "value"')
    expect(content.match(/\[mcp_servers\.loci\]/g)).toHaveLength(1)
  })

  it('按官方字段写入 Claude Code 与 Antigravity stdio 配置', () => {
    const claude = writeAgentMcpConfigFile('claude-code', LOCI_CLI_STDIO_CONNECTION, { homeDir })
    const antigravity = writeAgentMcpConfigFile('antigravity', LOCI_CLI_STDIO_CONNECTION, {
      homeDir
    })

    expect(JSON.parse(readFileSync(claude.path, 'utf8'))).toHaveProperty('mcpServers.loci', {
      type: 'stdio',
      command: 'loci',
      args: ['mcp', 'stdio']
    })
    expect(JSON.parse(readFileSync(antigravity.path, 'utf8'))).toHaveProperty('mcpServers.loci', {
      command: 'loci',
      args: ['mcp', 'stdio']
    })
  })

  it('已有配置无法解析或结构冲突时保持原文件', () => {
    const path = resolveAgentMcpConfigPath('cursor', { homeDir })
    mkdirSync(dirname(path), { recursive: true })
    const original = '{ invalid json }\n'
    writeFileSync(path, original, 'utf8')

    expect(() => writeAgentMcpConfigFile('cursor', LOCI_CLI_STDIO_CONNECTION, { homeDir })).toThrow(
      '未修改'
    )
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('目标服务容器不是对象时保持原文件', () => {
    const path = resolveAgentMcpConfigPath('cursor', { homeDir })
    mkdirSync(dirname(path), { recursive: true })
    const original = '{ "mcpServers": [] }\n'
    writeFileSync(path, original, 'utf8')

    expect(() => writeAgentMcpConfigFile('cursor', LOCI_CLI_STDIO_CONNECTION, { homeDir })).toThrow(
      'mcpServers 不是对象'
    )
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('Codex 重复 loci 表时保持原文件', () => {
    const path = resolveAgentMcpConfigPath('codex', { homeDir })
    mkdirSync(dirname(path), { recursive: true })
    const original = '[mcp_servers.loci]\ncommand = "a"\n\n[mcp_servers."loci"]\ncommand = "b"\n'
    writeFileSync(path, original, 'utf8')

    expect(() => writeAgentMcpConfigFile('codex', LOCI_CLI_STDIO_CONNECTION, { homeDir })).toThrow(
      '配置重复'
    )
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('按操作系统解析 VS Code 默认用户 Profile 路径', () => {
    expect(resolveAgentMcpConfigPath('vscode', { homeDir, platform: 'darwin' })).toContain(
      'Library/Application Support/Code/User/mcp.json'
    )
    expect(
      resolveAgentMcpConfigPath('vscode', {
        homeDir,
        platform: 'win32',
        environment: { APPDATA: 'C:\\Users\\demo\\AppData\\Roaming' }
      })
    ).toContain('Code/User/mcp.json')
    expect(
      resolveAgentMcpConfigPath('vscode', {
        homeDir,
        platform: 'linux',
        environment: { XDG_CONFIG_HOME: join(root, 'config') }
      })
    ).toBe(join(root, 'config', 'Code', 'User', 'mcp.json'))
  })

  it('检查并只移除标准 loci 服务，保留其他 JSONC 配置', () => {
    const path = resolveAgentMcpConfigPath('cursor', { homeDir })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
      path,
      '{\n  // 用户服务\n  "mcpServers": { "other": { "command": "other" } }\n}\n',
      'utf8'
    )
    writeAgentMcpConfigFile('cursor', LOCI_CLI_STDIO_CONNECTION, { homeDir })

    expect(inspectAgentMcpConfigFile('cursor', LOCI_CLI_STDIO_CONNECTION, { homeDir }).status).toBe(
      'current'
    )
    expect(removeAgentMcpConfigFile('cursor', LOCI_CLI_STDIO_CONNECTION, { homeDir }).changed).toBe(
      true
    )
    const content = readFileSync(path, 'utf8')
    expect(content).toContain('// 用户服务')
    expect(content).toContain('other')
    expect(content).not.toContain('"loci"')
  })

  it('loci 服务被用户修改时拒绝删除', () => {
    const path = resolveAgentMcpConfigPath('antigravity', { homeDir })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '{ "mcpServers": { "loci": { "command": "custom" } } }\n', 'utf8')

    expect(
      inspectAgentMcpConfigFile('antigravity', LOCI_CLI_STDIO_CONNECTION, { homeDir })
    ).toMatchObject({ status: 'conflict' })
    expect(() =>
      removeAgentMcpConfigFile('antigravity', LOCI_CLI_STDIO_CONNECTION, { homeDir })
    ).toThrow()
    expect(readFileSync(path, 'utf8')).toContain('custom')
  })

  it('检查并移除 Codex loci 表，保留其他 TOML', () => {
    const path = resolveAgentMcpConfigPath('codex', { homeDir })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'model = "gpt-5"\n\n', 'utf8')
    writeAgentMcpConfigFile('codex', LOCI_CLI_STDIO_CONNECTION, { homeDir })

    expect(inspectAgentMcpConfigFile('codex', LOCI_CLI_STDIO_CONNECTION, { homeDir }).status).toBe(
      'current'
    )
    removeAgentMcpConfigFile('codex', LOCI_CLI_STDIO_CONNECTION, { homeDir })
    expect(readFileSync(path, 'utf8')).toBe('model = "gpt-5"\n')
  })
})
