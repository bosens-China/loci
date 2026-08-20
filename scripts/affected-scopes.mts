import { appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const qualityScopeNames = [
  'root',
  'scripts',
  'core',
  'shared',
  'runtime',
  'cli',
  'server',
  'web',
  'docs'
] as const

export type QualityScope = (typeof qualityScopeNames)[number]

export interface AffectedScopes extends Record<QualityScope, boolean> {
  code: boolean
}

function createScopes(): AffectedScopes {
  return {
    code: false,
    root: false,
    scripts: false,
    core: false,
    shared: false,
    runtime: false,
    cli: false,
    server: false,
    web: false,
    docs: false
  }
}

function mark(scopes: AffectedScopes, ...names: QualityScope[]): void {
  scopes.code = true
  for (const name of names) scopes[name] = true
}

function markAll(scopes: AffectedScopes): void {
  mark(scopes, ...qualityScopeNames)
}

function markCore(scopes: AffectedScopes): void {
  mark(scopes, 'core', 'shared', 'runtime', 'cli', 'server', 'web')
}

function markShared(scopes: AffectedScopes): void {
  mark(scopes, 'core', 'shared', 'runtime', 'cli', 'server', 'web')
}

function markRuntime(scopes: AffectedScopes): void {
  mark(scopes, 'runtime', 'cli', 'web')
}

function isRootConfig(path: string): boolean {
  if (path.includes('/')) return false
  return (
    path === 'package.json' ||
    path === 'pnpm-lock.yaml' ||
    path === 'pnpm-workspace.yaml' ||
    path === '.npmrc' ||
    path === '.release-please-manifest.json' ||
    path === 'release-please-config.json' ||
    /^tsconfig(?:\.[^.]+)*\.json$/.test(path) ||
    /^[^.].*\.config\.[^.]+$/.test(path)
  )
}

// 路径映射同时编码 workspace 的依赖传播关系，避免只检查直接修改的包。
function applyPath(scopes: AffectedScopes, rawPath: string): void {
  const path = rawPath.replace(/^\.\//, '')

  // 内置 Skill 会随 CLI npm 包发布，不能按普通 Markdown 跳过。
  if (path.startsWith('.agents/skills/use-loci/')) {
    mark(scopes, 'cli')
    return
  }

  if (path.startsWith('apps/docs/') || path === '.github/workflows/docs-pages.yml') {
    mark(scopes, 'docs')
    return
  }

  if (path.startsWith('docs/') || path.endsWith('.md')) {
    return
  }

  if (path.startsWith('apps/cli/')) {
    mark(scopes, 'cli')
    return
  }
  if (path.startsWith('apps/web/')) {
    // Web 产物随 CLI npm 包分发，因此浏览器代码变化也必须重建 CLI。
    mark(scopes, 'cli', 'web')
    return
  }
  if (path.startsWith('apps/server/')) {
    mark(scopes, 'server')
    return
  }
  if (path.startsWith('packages/core/')) {
    markCore(scopes)
    return
  }
  if (path.startsWith('packages/shared/')) {
    markShared(scopes)
    return
  }
  if (path.startsWith('packages/runtime/')) {
    markRuntime(scopes)
    return
  }

  if (
    isRootConfig(path) ||
    path.startsWith('scripts/') ||
    path === '.github/workflows/ci.yml' ||
    path === '.github/workflows/release.yml' ||
    path.startsWith('.github/actions/')
  ) {
    markAll(scopes)
    return
  }

  if (
    path === 'compose.yaml' ||
    path === 'compose.local.yaml' ||
    path === '.dockerignore' ||
    path === '.env.example'
  ) {
    mark(scopes, 'server')
    return
  }

  // 新增 workspace 未进入显式映射时保守执行全量检查。
  if (path.startsWith('apps/') || path.startsWith('packages/')) markAll(scopes)
}

export function detectAffectedScopes(paths: readonly string[]): AffectedScopes {
  const scopes = createScopes()
  for (const path of paths) applyPath(scopes, path)
  return scopes
}

export function allScopes(): AffectedScopes {
  const scopes = createScopes()
  markAll(scopes)
  return scopes
}

export function listQualityScopes(scopes: AffectedScopes): QualityScope[] {
  return qualityScopeNames.filter((name) => scopes[name])
}

function commitExists(commit: string): boolean {
  if (!commit || /^0+$/.test(commit)) return false
  return (
    spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], { stdio: 'ignore' }).status === 0
  )
}

function readChangedPaths(base: string, head: string): string[] {
  const result = spawnSync('git', ['diff', '--name-only', base, head], {
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `无法读取 ${base}..${head} 的文件差异`)
  }
  return result.stdout.split('\n').filter(Boolean)
}

function writeOutputs(scopes: AffectedScopes): void {
  const lines = [
    `code=${scopes.code}`,
    ...qualityScopeNames.map((name) => `${name}=${scopes[name]}`),
    `quality_scopes=${listQualityScopes(scopes).join(',')}`
  ]
  const outputPath = process.env.GITHUB_OUTPUT
  if (outputPath) appendFileSync(outputPath, `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
}

function run(): void {
  const eventName = process.env.EVENT_NAME ?? ''
  const base =
    eventName === 'pull_request' ? (process.env.PR_BASE_SHA ?? '') : (process.env.BEFORE_SHA ?? '')
  const head = process.env.GITHUB_SHA ?? 'HEAD'
  const scopes = commitExists(base)
    ? detectAffectedScopes(readChangedPaths(base, head))
    : allScopes()
  writeOutputs(scopes)
}

const entryPath = process.argv[1]
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) run()
