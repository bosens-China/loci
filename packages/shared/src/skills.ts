export const SKILL_AGENTS = [
  'universal',
  'codex',
  'cursor',
  'claude-code',
  'vscode',
  'antigravity',
  'all'
] as const

export type SkillAgent = (typeof SKILL_AGENTS)[number]
export type ConcreteSkillAgent = Exclude<SkillAgent, 'all'>
export type SkillScope = 'global' | 'project'
export type SkillInstallationStatus = 'current' | 'outdated' | 'modified' | 'missing' | 'conflict'

export interface SkillOperationInput {
  name?: string
  agent?: SkillAgent
  project?: string
}

export interface SkillInstallation {
  id: string
  name: string
  requestedAgent: ConcreteSkillAgent
  compatibleAgents: ConcreteSkillAgent[]
  scope: SkillScope
  projectRoot: string | null
  targetPath: string
  packageVersion: string
  contentDigest: string
  status: SkillInstallationStatus
  modified: boolean
  createdAt: string
  updatedAt: string
}

export interface SkillTargetPreview {
  name: string
  requestedAgent: ConcreteSkillAgent
  compatibleAgents: ConcreteSkillAgent[]
  scope: SkillScope
  projectRoot: string | null
  targetPath: string
  status: SkillInstallationStatus | 'absent'
  modified: boolean
}

export interface SkillOperationResult {
  action: 'installed' | 'reinstalled' | 'unchanged' | 'removed' | 'missing'
  name: string
  targetPath: string
}

export interface SkillClearResult {
  removed: number
  missing: number
  failures: Array<{ targetPath: string; message: string }>
}

export interface SkillProjectSelection {
  canceled: boolean
  path: string | null
}

export function isSkillAgent(value: unknown): value is SkillAgent {
  return typeof value === 'string' && (SKILL_AGENTS as readonly string[]).includes(value)
}
