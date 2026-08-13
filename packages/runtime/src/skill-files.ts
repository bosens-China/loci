import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ConcreteSkillAgent, SkillAgent } from '@loci/shared'
import { isSkillAgent } from '@loci/shared'

export const DEFAULT_SKILL = 'use-loci'
export const SKILL_MARKER = '.loci-skill.json'
export const CONCRETE_SKILL_AGENTS: ConcreteSkillAgent[] = [
  'universal',
  'codex',
  'cursor',
  'claude-code',
  'vscode',
  'antigravity'
]

interface SkillMarker {
  schemaVersion: 1
  name: string
  provider: 'loci'
  packageVersion: string
  contentDigest: string
}

export function resolveSkillPath(
  agent: ConcreteSkillAgent,
  name: string,
  project: string | null,
  home: string
): string {
  const base = project ?? home
  const paths: Record<ConcreteSkillAgent, [string, string]> = {
    universal: ['.agents/skills', '.agents/skills'],
    codex: ['.agents/skills', '.agents/skills'],
    cursor: ['.cursor/skills', '.cursor/skills'],
    'claude-code': ['.claude/skills', '.claude/skills'],
    vscode: ['.copilot/skills', '.github/skills'],
    antigravity: ['.gemini/config/skills', '.agents/skills']
  }
  return resolve(base, project ? paths[agent][1] : paths[agent][0], name)
}

export function compatibleAgents(
  path: string,
  project: string | null,
  home: string
): ConcreteSkillAgent[] {
  return CONCRETE_SKILL_AGENTS.filter(
    (agent) => resolveSkillPath(agent, DEFAULT_SKILL, project, home) === path
  )
}

export function resolveProject(path: string): string {
  const target = resolve(path)
  if (!isAbsolute(target) || !existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`项目目录不存在：${target}`)
  }
  return realpathSync(target)
}

export function parseSkillAgent(value: SkillAgent | undefined): SkillAgent {
  const agent = value ?? 'universal'
  if (!isSkillAgent(agent)) throw new Error(`不支持的 Agent：${String(agent)}`)
  return agent
}

export function builtinSkillDigest(resourceDir: string): string {
  return digestFiles(resourceDir, listFiles(resourceDir))
}

export function writeBuiltinSkill(
  resourceDir: string,
  path: string,
  packageVersion: string,
  digest: string
): void {
  const files = listFiles(resourceDir)
  if (!files.includes('SKILL.md')) throw new Error(`内置 Skill 资源不完整：${resourceDir}`)
  for (const relativePath of files) {
    if (relativePath === SKILL_MARKER) throw new Error('内置 Skill 资源不能包含所有权标记')
    const source = resolve(resourceDir, relativePath)
    const target = resolve(path, relativePath)
    if (relative(path, target).startsWith('..')) throw new Error('内置 Skill 路径越界')
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
    chmodSync(target, lstatSync(source).mode & 0o777)
  }
  const marker: SkillMarker = {
    schemaVersion: 1,
    name: DEFAULT_SKILL,
    provider: 'loci',
    packageVersion,
    contentDigest: digest
  }
  writeFileSync(join(path, SKILL_MARKER), `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
}

export function digestSkillDirectory(path: string): string {
  return digestFiles(
    path,
    listFiles(path).filter((relativePath) => relativePath !== SKILL_MARKER)
  )
}

export function readSkillMarker(path: string): SkillMarker | undefined {
  try {
    const value = JSON.parse(readFileSync(join(path, SKILL_MARKER), 'utf8')) as Partial<SkillMarker>
    return value.schemaVersion === 1 &&
      value.provider === 'loci' &&
      typeof value.name === 'string' &&
      typeof value.contentDigest === 'string' &&
      typeof value.packageVersion === 'string'
      ? (value as SkillMarker)
      : undefined
  } catch {
    return undefined
  }
}

export function validSkillMarker(path: string, name: string): boolean {
  const marker = readSkillMarker(path)
  return marker?.name === name && marker.provider === 'loci'
}

export function skillLockKey(path: string): string {
  return `skill-${createHash('sha256').update(path).digest('hex')}`
}

export function transactionPath(
  target: string,
  suffix: 'tmp' | 'backup' | 'remove',
  id: string
): string {
  return join(dirname(target), `.${basename(target)}.${id}.${suffix}`)
}

function listFiles(root: string, current = ''): string[] {
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new Error(`内置 Skill 资源目录不存在：${root}`)
  }
  return readdirSync(join(root, current), { withFileTypes: true }).flatMap((entry) => {
    const path = current ? join(current, entry.name) : entry.name
    if (entry.isDirectory()) return listFiles(root, path)
    if (!entry.isFile()) throw new Error(`内置 Skill 资源包含不支持的文件类型：${path}`)
    return [path]
  })
}

function digestFiles(root: string, files: readonly string[]): string {
  const hash = createHash('sha256')
  for (const path of [...files].sort((left, right) => left.localeCompare(right))) {
    hash
      .update(path)
      .update('\0')
      .update(readFileSync(join(root, path)))
      .update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}
