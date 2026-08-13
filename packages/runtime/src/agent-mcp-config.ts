import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser/lib/esm/main.js'
import {
  createMcpClientConfig,
  getMcpClientDefinition,
  type AgentClient,
  type McpAgentConnection
} from '@loci/shared'
import { writeFileAtomically } from './atomic-file.js'

export interface AgentMcpConfigPathOptions {
  homeDir?: string
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
}

export interface AgentMcpConfigWriteResult {
  path: string
  changed: boolean
  created: boolean
}

type JsonObject = Record<string, unknown>

/** 解析客户端真实的用户级配置路径，供 CLI、桌面和文件回退共同使用。 */
export function resolveAgentMcpConfigPath(
  client: AgentClient,
  options: AgentMcpConfigPathOptions = {}
): string {
  const home = options.homeDir ?? homedir()
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  switch (client) {
    case 'codex':
      return resolve(home, '.codex', 'config.toml')
    case 'cursor':
      return resolve(home, '.cursor', 'mcp.json')
    case 'claude-code':
      return resolve(home, '.claude.json')
    case 'antigravity':
      return resolve(home, '.gemini', 'config', 'mcp_config.json')
    case 'vscode':
      if (platform === 'darwin') {
        return resolve(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
      }
      if (platform === 'win32') {
        return resolve(
          environment.APPDATA ?? join(home, 'AppData', 'Roaming'),
          'Code',
          'User',
          'mcp.json'
        )
      }
      return resolve(
        environment.XDG_CONFIG_HOME ?? join(home, '.config'),
        'Code',
        'User',
        'mcp.json'
      )
  }
}

/** 调用方需持有客户端配置锁；这里只负责读取、合并和原子写入。 */
export function writeAgentMcpConfigFile(
  client: AgentClient,
  connection: McpAgentConnection,
  options: AgentMcpConfigPathOptions = {}
): AgentMcpConfigWriteResult {
  const path = resolveAgentMcpConfigPath(client, options)
  const created = !existsSync(path)
  const current = created ? '' : readFileSync(path, 'utf8')
  const next =
    client === 'codex'
      ? mergeCodexConfig(current, createMcpClientConfig(client, connection), path)
      : mergeJsonConfig(current, client, connection, path)
  const changed = current !== next
  if (changed) writeFileAtomically(path, next)
  return { path, changed, created }
}

function mergeJsonConfig(
  current: string,
  client: Exclude<AgentClient, 'codex'>,
  connection: McpAgentConnection,
  path: string
): string {
  const root = parseJsonObject(current, path)
  const fragment = parseJsonObject(createMcpClientConfig(client, connection), path)
  const key = client === 'vscode' ? 'servers' : 'mcpServers'
  const existingServers = root[key]
  if (existingServers !== undefined && !isJsonObject(existingServers)) {
    throw new Error(`MCP 配置中的 ${key} 不是对象，未修改：${path}`)
  }
  const generatedServers = fragment[key]
  if (!isJsonObject(generatedServers) || !('loci' in generatedServers)) {
    throw new Error(`无法生成 ${getMcpClientDefinition(client).label} MCP 配置`)
  }
  const source = current.trim() ? current : '{}\n'
  const indent = detectJsonIndent(current)
  const next = applyEdits(
    source,
    modify(source, [key, 'loci'], generatedServers.loci, {
      formattingOptions: {
        insertSpaces: indent !== '\t',
        tabSize: indent === '\t' ? 1 : indent,
        eol: current.includes('\r\n') ? '\r\n' : '\n'
      }
    })
  )
  return `${next.trimEnd()}\n`
}

function parseJsonObject(content: string, path: string): JsonObject {
  if (!content.trim()) return {}
  const errors: ParseError[] = []
  const parsed: unknown = parse(content, errors, { allowTrailingComma: true })
  if (errors.length === 0 && isJsonObject(parsed)) return parsed
  throw new Error(`MCP 配置不是有效的 JSON 对象，未修改：${path}`)
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function detectJsonIndent(content: string): '\t' | number {
  const match = content.match(/^([\t ]+)\S/m)
  if (match?.[1]?.includes('\t')) return '\t'
  return match?.[1]?.length ?? 2
}

function mergeCodexConfig(current: string, fragment: string, path: string): string {
  const sectionPattern = /^[\t ]*\[mcp_servers(?:\.loci|\."loci")\][\t ]*(?:#.*)?$/gm
  const matches = [...current.matchAll(sectionPattern)]
  if (matches.length > 1) throw new Error(`Codex loci MCP 配置重复，未修改：${path}`)
  if (matches.length === 1) {
    const start = matches[0]!.index
    const end = findCodexSectionEnd(current, start)
    return normalizeText(
      [current.slice(0, start).trimEnd(), fragment.trim(), current.slice(end).trimStart()]
        .filter(Boolean)
        .join('\n\n')
    )
  }
  if (hasInlineCodexConfig(current) || /^[\t ]*\[mcp_servers(?:\.loci|\."loci")\./m.test(current)) {
    throw new Error(`Codex loci MCP 配置结构冲突，未修改：${path}`)
  }
  const separator = current.trim() ? (current.endsWith('\n') ? '\n' : '\n\n') : ''
  return normalizeText(`${current}${separator}${fragment}`)
}

function findCodexSectionEnd(content: string, start: number): number {
  const firstLineEnd = content.indexOf('\n', start)
  if (firstLineEnd === -1) return content.length
  const offset = firstLineEnd + 1
  const rest = content.slice(offset)
  const headerPattern = /^[\t ]*\[[^\]]+\][\t ]*(?:#.*)?$/gm
  for (const match of rest.matchAll(headerPattern)) {
    const header = match[0]
    if (/^[\t ]*\[mcp_servers(?:\.loci|\."loci")\./.test(header)) continue
    return offset + match.index
  }
  return content.length
}

function hasInlineCodexConfig(content: string): boolean {
  if (/^[\t ]*mcp_servers(?:\.loci)?[\t ]*=/m.test(content)) return true
  const parent = /^[\t ]*\[mcp_servers\][\t ]*(?:#.*)?$/m.exec(content)
  if (!parent) return false
  const nextHeader = /^[\t ]*\[[^\]]+\]/gm
  nextHeader.lastIndex = parent.index + parent[0].length
  const next = nextHeader.exec(content)
  return /^[\t ]*loci[\t ]*=/m.test(content.slice(parent.index + parent[0].length, next?.index))
}

function normalizeText(content: string): string {
  return `${content.trimEnd()}\n`
}
