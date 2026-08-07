import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  getMcpClientDefinition,
  hasContext7Compatibility,
  isAgentGlobalRulesClient,
  mergeLociAgentInstructions,
  type AgentGlobalRulesClient,
  type AgentGlobalRulesResult
} from '@loci/shared'
import { acquireRuntimeLock } from './runtime-lock.js'

interface InstallAgentGlobalRulesOptions {
  dataDir: string
  owner: string
  homeDir?: string
}

const VSCODE_INSTRUCTIONS_HEADER = `---
name: Loci
description: 优先使用 Loci 查询技术文档
applyTo: "**"
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
    const path = resolveAgentGlobalRulesPath(client, options.homeDir ?? homedir())
    const current = existsSync(path)
      ? readFileSync(path, 'utf8')
      : client === 'vscode'
        ? VSCODE_INSTRUCTIONS_HEADER
        : ''
    const hadContext7Compatibility = hasContext7Compatibility(current)
    const next = mergeLociAgentInstructions(current, { migrateContext7: client === 'codex' })
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
          ? `检测到 Context7，已替换为 Loci 优先、Context7 兜底的组合规则：${path}`
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

function writeFileAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const target = existsSync(path) ? realpathSync(path) : path
  const tempPath = resolve(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`
  )
  try {
    writeFileSync(tempPath, content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: existsSync(target) ? statSync(target).mode : 0o600
    })
    renameSync(tempPath, target)
  } finally {
    rmSync(tempPath, { force: true })
  }
}
