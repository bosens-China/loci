import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import {
  getMcpClientDefinition,
  hasContext7Compatibility,
  hasLociAgentInstructions,
  isAgentGlobalRulesClient,
  mergeLociAgentInstructions,
  removeLociAgentInstructions,
  type AgentGlobalRulesClient,
  type AgentGlobalRulesResult
} from '@loci/shared'
import { writeFileAtomically } from './atomic-file.js'
import { acquireRuntimeLock } from './runtime-lock.js'

export interface InstallAgentGlobalRulesOptions {
  dataDir: string
  owner: string
  homeDir?: string
}

export interface AgentGlobalRulesState {
  path: string
  status: 'missing' | 'current' | 'outdated' | 'conflict'
  message: string | null
}

const VSCODE_INSTRUCTIONS_HEADER = `---
name: Loci
description: 优先使用 Loci 查询技术文档
applyTo: "**"
---

`

const CURSOR_RULES_HEADER = `---
description: 优先使用 Loci 查询技术文档
globs:
alwaysApply: true
---

`

/** 写入用户级规则；同步文件操作让同一进程天然串行，文件锁负责跨进程仲裁。 */
export function installAgentGlobalRules(
  client: unknown,
  options: InstallAgentGlobalRulesOptions
): AgentGlobalRulesResult {
  if (!isAgentGlobalRulesClient(client)) throw new Error('这个 Agent 客户端不支持全局规则写入')

  const lock = acquireRuntimeLock(options.dataDir, `agent-global-rules-${client}`, options.owner)
  try {
    const homeDir = options.homeDir ?? homedir()
    const path = resolveAgentGlobalRulesPath(client, homeDir)
    const current = existsSync(path) ? readFileSync(path, 'utf8') : initialRulesContent(client)
    if (client === 'cursor') assertCursorRulesFile(current)
    const hadContext7Compatibility = hasContext7Compatibility(current)
    const next = mergeLociAgentInstructions(current, {
      migrateContext7: client === 'codex',
      context7Available: isContext7Available(client, homeDir)
    })
    const hasContext7 = hasContext7Compatibility(next)
    const changed = current !== next
    if (changed) writeFileAtomically(path, next)
    const label = getMcpClientDefinition(client).label
    return {
      client,
      path,
      changed,
      message:
        changed && hasContext7 && !hadContext7Compatibility
          ? client === 'codex'
            ? `检测到 Context7，已替换为 Loci 优先、Context7 兜底的组合规则：${path}`
            : `检测到 Context7，已写入 Loci 优先、Context7 兜底的组合规则：${path}`
          : changed
            ? `已将 Loci 全局规则写入 ${label}：${path}`
            : hasContext7
              ? `${label} 的 Loci 与 Context7 组合规则已是最新版本：${path}`
              : `${label} 的 Loci 全局规则已是最新版本：${path}`
    }
  } finally {
    lock.release()
  }
}

/** 只读检查规则区块是否存在、是否为当前版本。 */
export function inspectAgentGlobalRules(
  client: AgentGlobalRulesClient,
  options: Pick<InstallAgentGlobalRulesOptions, 'homeDir'>
): AgentGlobalRulesState {
  const homeDir = options.homeDir ?? homedir()
  const path = resolveAgentGlobalRulesPath(client, homeDir)
  if (!existsSync(path)) return { path, status: 'missing', message: null }
  const current = readFileSync(path, 'utf8')
  try {
    if (client === 'cursor') assertCursorRulesFile(current)
    if (!hasLociAgentInstructions(current)) return { path, status: 'missing', message: null }
    const expected = mergeLociAgentInstructions(current, {
      migrateContext7: client === 'codex',
      context7Available: isContext7Available(client, homeDir)
    })
    return {
      path,
      status: current === expected ? 'current' : 'outdated',
      message: null
    }
  } catch (error) {
    return {
      path,
      status: 'conflict',
      message: error instanceof Error ? error.message : '全局规则无法安全识别'
    }
  }
}

/** 只删除 Loci 受管区块；调用方不需要处理其他用户规则。 */
export function removeAgentGlobalRules(
  client: AgentGlobalRulesClient,
  options: InstallAgentGlobalRulesOptions
): AgentGlobalRulesResult {
  const lock = acquireRuntimeLock(options.dataDir, `agent-global-rules-${client}`, options.owner)
  try {
    const homeDir = options.homeDir ?? homedir()
    const path = resolveAgentGlobalRulesPath(client, homeDir)
    if (!existsSync(path)) {
      return { client, path, changed: false, message: `Loci 全局规则不存在：${path}` }
    }
    const current = readFileSync(path, 'utf8')
    if (client === 'cursor') assertCursorRulesFile(current)
    const next = removeLociAgentInstructions(current)
    if (next.removed) {
      if (client === 'cursor' && isEmptyCursorRulesFile(next.content)) unlinkSync(path)
      else writeFileAtomically(path, next.content)
    }
    return {
      client,
      path,
      changed: next.removed,
      message: next.removed ? `已移除 Loci 全局规则：${path}` : `Loci 全局规则不存在：${path}`
    }
  } finally {
    lock.release()
  }
}

function initialRulesContent(client: AgentGlobalRulesClient): string {
  if (client === 'vscode') return VSCODE_INSTRUCTIONS_HEADER
  if (client === 'cursor') return CURSOR_RULES_HEADER
  return ''
}

/** Cursor 仅加载带 MDC frontmatter 的规则，异常文件必须交给用户处理。 */
function assertCursorRulesFile(content: string): void {
  const normalized = content.replaceAll('\r\n', '\n')
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1]
  if (!frontmatter) throw new Error('Cursor 全局规则缺少有效的 MDC frontmatter，请先手动修复')
  if (!/^alwaysApply:\s*true\s*$/m.test(frontmatter)) {
    throw new Error('Cursor 全局规则必须设置 alwaysApply: true，请先手动修复')
  }
}

function isEmptyCursorRulesFile(content: string): boolean {
  return content.trim() === CURSOR_RULES_HEADER.trim()
}

/** Context7 可能晚于规则安装；每次重写都重新检查两个 Codex 用户级 Skill 入口。 */
function isContext7SkillInstalled(homeDir: string): boolean {
  return ['.agents/skills/context7-mcp/SKILL.md', '.codex/skills/context7-mcp/SKILL.md'].some(
    (path) => existsSync(resolve(homeDir, path))
  )
}

function isContext7Available(client: AgentGlobalRulesClient, homeDir: string): boolean {
  if (client === 'codex') return isContext7SkillInstalled(homeDir)
  if (client !== 'cursor') return false
  return [
    '.cursor/rules/context7.mdc',
    '.cursor/skills/context7-mcp/SKILL.md',
    '.cursor/skills/context7/SKILL.md'
  ].some((path) => existsSync(resolve(homeDir, path)))
}

export function resolveAgentGlobalRulesPath(
  client: AgentGlobalRulesClient,
  homeDir: string
): string {
  if (client === 'codex') {
    const overridePath = resolve(homeDir, '.codex', 'AGENTS.override.md')
    if (existsSync(overridePath)) return overridePath
  }
  const configured = getMcpClientDefinition(client).globalRulesPath
  if (!configured.startsWith('~/')) throw new Error('Agent 全局规则路径无效')
  return resolve(homeDir, configured.slice(2))
}
