import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { AgentClient } from '@loci/shared'
import {
  applyEdits,
  getNodeValue,
  modify,
  parseTree,
  type Node,
  type ParseError
} from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'
import { writeFileAtomically } from './atomic-file.js'

type LegacyClient = Exclude<AgentClient, 'pi'>
type Config = Record<string, unknown>

interface LegacyMcpPlan {
  path: string
  next?: string
  message?: string
}

function resolveConfig(client: LegacyClient, home: string): string {
  switch (client) {
    case 'codex':
      return resolve(home, '.codex/config.toml')
    case 'cursor':
      return resolve(home, '.cursor/mcp.json')
    case 'claude-code':
      return resolve(home, '.claude.json')
    case 'antigravity':
      return resolve(home, '.gemini/config/mcp_config.json')
    case 'vscode': {
      const settings =
        process.platform === 'darwin'
          ? resolve(home, 'Library/Application Support')
          : process.platform === 'win32'
            ? (process.env.APPDATA ?? resolve(home, 'AppData/Roaming'))
            : (process.env.XDG_CONFIG_HOME ?? resolve(home, '.config'))
      return resolve(settings, 'Code/User/mcp.json')
    }
  }
}

/** 只迁移旧安装生成的用户级条目，保留独立配置的同名服务。 */
export function inspectLegacyMcp(client: AgentClient, home: string): LegacyMcpPlan | null {
  if (client === 'pi') return null
  const path = resolveConfig(client, home)
  let current: string
  try {
    if (!statSync(path).isFile()) return { path, message: '旧版 MCP 配置路径需要是普通文件' }
    current = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return { path, message: '无法读取 MCP 配置，请检查文件权限' }
  }
  if (!current.trim()) return null
  try {
    const next = client === 'codex' ? removeTomlEntry(current) : removeJsonEntry(current, client)
    return next === undefined ? null : { path, next }
  } catch (error) {
    if (!/\bloci\b/i.test(current)) return null
    return {
      path,
      message: error instanceof LegacyMcpConflict ? error.message : 'MCP 配置格式无效，请先修复'
    }
  }
}

/** 在客户端配置锁内重新读取，原子写回，避免用页面预读的内容覆盖新配置。 */
export function cleanupLegacyMcp(client: AgentClient, home: string): boolean {
  const plan = inspectLegacyMcp(client, home)
  if (!plan) return false
  if (plan.next === undefined) throw new Error(plan.message)
  writeFileAtomically(plan.path, plan.next)
  return true
}

class LegacyMcpConflict extends Error {}

function removeJsonEntry(
  current: string,
  client: Exclude<LegacyClient, 'codex'>
): string | undefined {
  const errors: ParseError[] = []
  const tree = parseTree(current, errors, { allowTrailingComma: true })
  if (errors.length || tree?.type !== 'object') throw new Error('Invalid JSONC')
  const key = client === 'vscode' ? 'servers' : 'mcpServers'
  const server = readProperty(readProperty(tree, key), 'loci')
  if (!server) return undefined
  const value: unknown = getNodeValue(server)
  if (!isStandardEntry(value)) return undefined
  for (const field of ['command', 'args', 'type']) readProperty(server, field)
  const indent = /^[\t ]+\S/m.exec(current)?.[0].slice(0, -1) ?? '  '
  return applyEdits(
    current,
    modify(current, [key, 'loci'], undefined, {
      formattingOptions: {
        insertSpaces: !indent.includes('\t'),
        tabSize: indent.includes('\t') ? 1 : indent.length,
        eol: current.includes('\r\n') ? '\r\n' : '\n'
      }
    })
  )
}

function readProperty(node: Node | undefined, key: string): Node | undefined {
  if (!node) return undefined
  if (node.type !== 'object') throw new Error('Invalid JSONC object')
  const matches = node.children?.filter((item) => item.children?.[0]?.value === key) ?? []
  if (matches.length > 1) throw new LegacyMcpConflict(`MCP 配置中的 ${key} 条目重复，请先合并`)
  return matches[0]?.children?.[1]
}

function removeTomlEntry(current: string): string | undefined {
  const config = parseToml(current)
  const servers = configObject(config.mcp_servers)
  if (!servers || !Object.hasOwn(servers, 'loci')) return undefined
  if (!isStandardEntry(servers.loci)) return undefined
  const lines = current.split(/(?<=\n)/)
  const start = lines.findIndex((line) =>
    /^\s*\[mcp_servers\.(?:loci|"loci"|'loci')\]\s*(?:#.*)?$/u.test(line.trimEnd())
  )
  if (start === -1) throw new LegacyMcpConflict('请在客户端中移除旧版 loci MCP 条目')
  const end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line))
  const fields = lines.slice(start + 1, end === -1 ? undefined : end)
  // 只删旧版写入的单行字段，并用解析结果确认其他 TOML 内容仍然等价。
  const next = [
    ...lines.slice(0, start),
    ...fields.filter((line) => !/^\s*(?:command|args|type)\s*=/.test(line)),
    ...(end === -1 ? [] : lines.slice(end))
  ].join('')
  delete servers.loci
  const nextConfig = parseToml(next)
  if (!Object.keys(servers).length && nextConfig.mcp_servers === undefined) {
    delete config.mcp_servers
  }
  if (!isDeepStrictEqual(config, nextConfig)) {
    throw new LegacyMcpConflict('请在客户端中移除旧版 loci MCP 条目')
  }
  return next
}

function isStandardEntry(value: unknown): boolean {
  const entry = configObject(value)
  return (
    entry?.command === 'loci' &&
    Object.hasOwn(entry, 'command') &&
    Object.hasOwn(entry, 'args') &&
    isDeepStrictEqual(entry.args, ['mcp', 'stdio']) &&
    (entry.type === undefined || entry.type === 'stdio') &&
    Object.keys(entry).every((key) => ['command', 'args', 'type'].includes(key))
  )
}

function configObject(value: unknown): Config | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Config) : undefined
}
