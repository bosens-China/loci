import { Option, type Command } from 'commander'
import { SkillManager } from '@loci/runtime'
import { isSkillAgent, type SkillAgent, type SkillOperationInput } from '@loci/shared'
import { runWithRuntime } from '../command-runtime.js'
import { CliCanceledError, CliError } from '../errors.js'
import { askConfirm, note, printTable } from '../ui.js'
import { CLI_VERSION } from '../update.js'
import { resolveCliSkillResourceDir } from '../skill-resources.js'

interface SkillOptions {
  agent?: SkillAgent
  project?: string
  yes?: boolean
  json?: boolean
}

export function registerSkillsCommands(program: Command): void {
  const skills = program.command('skills').description('安装、查看和删除 Loci Agent Skills')

  skills
    .command('add [name]')
    .description('安装或重新安装 Skill；默认写入用户级全局目录')
    .addOption(agentOption())
    .option('--project <path>', '显式指定项目根目录；不传则操作全局')
    .option('--yes', '跳过替换确认')
    .action((name: string | undefined, options: SkillOptions) =>
      runWithRuntime('安装 Loci Skill', async (runtime) => {
        const manager = createManager(runtime)
        const input = toInput(name, options)
        const targets = manager.preview(input)
        if (!options.yes && process.stdin.isTTY) {
          note(
            targets
              .map(
                (target) =>
                  `${target.requestedAgent} · ${target.status} · ${target.targetPath}${target.modified ? '（本地修改将被替换）' : ''}`
              )
              .join('\n'),
            'Skills 写入预览'
          )
          if (!(await askConfirm('确认安装或整目录重新安装这些 Skill 吗？', true))) {
            throw new CliCanceledError()
          }
        }
        const results = await manager.add(input)
        return formatResults(results)
      })
    )

  skills
    .command('list')
    .description('查看 SQLite 记录并核对实际 Skill 目录')
    .addOption(agentOption())
    .option('--project <path>', '只查看指定项目的安装记录')
    .option('--json', '输出 JSON')
    .action((options: SkillOptions) =>
      runWithRuntime('Loci Skills', async (runtime) => {
        const items = createManager(runtime).list(toInput(undefined, options))
        if (options.json) process.stdout.write(`${JSON.stringify(items, null, 2)}\n`)
        else
          printTable(
            ['Skill', 'Agent', '范围', '状态', '目标路径'],
            items.map((item) => [
              item.name,
              item.compatibleAgents.join(', '),
              item.scope === 'global' ? '全局' : item.projectRoot,
              item.status,
              item.targetPath
            ])
          )
        return items.length ? `共 ${items.length} 条安装记录` : '暂无 Loci Skill 安装记录'
      })
    )

  skills
    .command('remove [name]')
    .description('删除 Skill；默认只操作用户级全局目录')
    .addOption(agentOption())
    .option('--project <path>', '显式指定要删除 Skill 的项目根目录')
    .option('--yes', '跳过删除确认')
    .action((name: string | undefined, options: SkillOptions) =>
      runWithRuntime('删除 Loci Skill', async (runtime) => {
        const manager = createManager(runtime)
        const input = toInput(name, options)
        const targets = manager.preview(input)
        if (!options.yes) {
          if (!process.stdin.isTTY) throw new CliError('非交互删除必须传入 --yes', 2)
          note(
            targets.map((target) => `${target.status} · ${target.targetPath}`).join('\n'),
            'Skills 删除预览'
          )
          if (!(await askConfirm('确认整目录删除这些 Loci Skill 吗？'))) {
            throw new CliCanceledError()
          }
        }
        return formatResults(await manager.remove(input))
      })
    )

  skills
    .command('clear')
    .description('批量清空 Loci 记录的 Skill；默认只清空全局')
    .addOption(agentOption())
    .option('--project <path>', '显式指定要清空 Skill 的项目根目录')
    .option('--yes', '跳过批量删除确认')
    .action((options: SkillOptions) =>
      runWithRuntime('清空 Loci Skills', async (runtime) => {
        const manager = createManager(runtime)
        const input = toInput(undefined, options)
        const items = manager.list({ ...input, agent: input.agent ?? 'all' })
        if (!options.yes) {
          if (!process.stdin.isTTY) throw new CliError('非交互清空必须传入 --yes', 2)
          note(items.map((item) => item.targetPath).join('\n') || '没有匹配记录', 'Skills 清空预览')
          if (!(await askConfirm(`确认清空 ${items.length} 个 Loci Skill 吗？`))) {
            throw new CliCanceledError()
          }
        }
        const result = await manager.clear(input)
        if (result.failures.length) {
          return {
            message: `已删除 ${result.removed} 个，缺失 ${result.missing} 个，失败 ${result.failures.length} 个`,
            tone: 'warning' as const
          }
        }
        return `已删除 ${result.removed} 个，缺失 ${result.missing} 个`
      })
    )
}

function agentOption(): Option {
  return new Option('--agent <agent>', 'Agent 目标；默认 universal').choices([
    'universal',
    'codex',
    'cursor',
    'claude-code',
    'vscode',
    'antigravity',
    'all'
  ])
}

function toInput(name: string | undefined, options: SkillOptions): SkillOperationInput {
  if (options.agent !== undefined && !isSkillAgent(options.agent)) {
    throw new CliError(`不支持的 Agent：${String(options.agent)}`, 2)
  }
  return { name, agent: options.agent, project: options.project }
}

function createManager(runtime: Parameters<Parameters<typeof runWithRuntime>[1]>[0]): SkillManager {
  return new SkillManager({
    database: runtime.database,
    dataDir: runtime.dataDir,
    packageVersion: CLI_VERSION,
    skillResourceDir: resolveCliSkillResourceDir()
  })
}

function formatResults(results: Array<{ action: string; targetPath: string }>): string {
  const labels: Record<string, string> = {
    installed: '已安装',
    reinstalled: '已重新安装',
    unchanged: '已是最新',
    removed: '已删除',
    missing: '文件已不存在，记录已清理'
  }
  return results
    .map((result) => `${labels[result.action] ?? result.action}：${result.targetPath}`)
    .join('\n')
}
