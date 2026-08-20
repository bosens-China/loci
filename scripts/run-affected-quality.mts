import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { qualityScopeNames, type QualityScope } from './affected-scopes.mts'

interface Command {
  args: string[]
}

const packageByScope: Partial<Record<QualityScope, string>> = {
  core: '@loci/core',
  shared: '@loci/shared',
  runtime: '@loci/runtime',
  cli: '@boses/cli',
  server: '@loci/server',
  web: '@loci/web',
  docs: '@loci/docs'
}

const directoryByScope: Partial<Record<QualityScope, string>> = {
  scripts: 'scripts',
  core: 'packages/core',
  shared: 'packages/shared',
  runtime: 'packages/runtime',
  cli: 'apps/cli',
  server: 'apps/server',
  web: 'apps/web',
  docs: 'apps/docs'
}

export function parseQualityScopes(value: string): QualityScope[] {
  const allowed = new Set<string>(qualityScopeNames)
  const scopes = value.split(',').filter(Boolean)
  for (const scope of scopes) {
    if (!allowed.has(scope)) throw new Error(`未知 CI scope：${scope}`)
  }
  return scopes as QualityScope[]
}

function packageFilters(scopes: readonly QualityScope[], includeDependencies = false): string[] {
  return scopes.flatMap((scope) => {
    const packageName = packageByScope[scope]
    return packageName ? ['--filter', `${packageName}${includeDependencies ? '...' : ''}`] : []
  })
}

export function createInstallCommand(scopes: readonly QualityScope[]): Command {
  if (scopes.includes('root')) return { args: ['install', '--frozen-lockfile'] }
  return {
    args: ['install', '--frozen-lockfile', '--filter', 'loci', ...packageFilters(scopes, true)]
  }
}

export function createQualityCommands(scopes: readonly QualityScope[]): Command[] {
  if (scopes.includes('root')) {
    return [
      { args: ['check:release-versions'] },
      { args: ['lint'] },
      { args: ['test'] },
      { args: ['typecheck'] },
      { args: ['docs:build'] }
    ]
  }

  const commands: Command[] = [{ args: ['check:release-versions'] }]
  const lintTargets = scopes.flatMap((scope) => directoryByScope[scope] ?? [])
  if (lintTargets.length > 0) commands.push({ args: ['exec', 'eslint', '--cache', ...lintTargets] })

  if (scopes.includes('scripts')) {
    commands.push(
      { args: ['exec', 'vitest', 'run', 'scripts/test'] },
      { args: ['exec', 'tsc', '--noEmit', '-p', 'tsconfig.scripts.json'] }
    )
  }

  const testScopes = scopes.filter((scope) => packageByScope[scope] && scope !== 'docs')
  if (testScopes.length > 0) commands.push({ args: [...packageFilters(testScopes), 'test'] })

  const typecheckScopes = scopes.filter((scope) => packageByScope[scope])
  if (typecheckScopes.length > 0) {
    commands.push({ args: [...packageFilters(typecheckScopes), 'typecheck'] })
  }
  if (scopes.includes('docs')) commands.push({ args: ['--filter', '@loci/docs', 'build'] })
  return commands
}

function execute(command: Command): void {
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(executable, command.args, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`pnpm ${command.args.join(' ')} 执行失败`)
}

function run(): void {
  const [mode, rawScopes = ''] = process.argv.slice(2)
  const scopes = parseQualityScopes(rawScopes)
  if (mode === 'install') {
    execute(createInstallCommand(scopes))
    return
  }
  if (mode === 'check') {
    for (const command of createQualityCommands(scopes)) execute(command)
    return
  }
  throw new Error('用法：run-affected-quality.mts <install|check> <scope,...>')
}

const entryPath = process.argv[1]
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) run()
