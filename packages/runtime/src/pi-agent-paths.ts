import { statSync } from 'node:fs'
import { resolve } from 'node:path'

export function resolvePiAgentDir(homeDir: string): string {
  const override = process.env.PI_CODING_AGENT_DIR
  if (!override) return resolve(homeDir, '.pi/agent')
  if (override === '~') return homeDir
  if (override.startsWith('~/') || (process.platform === 'win32' && override.startsWith('~\\'))) {
    return resolve(homeDir, override.slice(2))
  }
  return resolve(override)
}

/** 按 Pi 查找用户指令的顺序，选择已经生效的规则文件。 */
export function resolvePiRulesPath(homeDir: string): string {
  const dir = resolvePiAgentDir(homeDir)
  const candidates = ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']
  const active = candidates.find((name) =>
    statSync(resolve(dir, name), { throwIfNoEntry: false })?.isFile()
  )
  return resolve(dir, active ?? 'AGENTS.md')
}
