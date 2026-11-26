import { Option, type Command } from 'commander'
import { SkillManager } from '@loci/runtime'
import { SKILL_AGENTS, type SkillAgent } from '@loci/shared'
import { jsonOption, output, withRuntime, type OutputOptions } from '../command-runtime.js'
import { confirmWrite } from '../ui.js'
import { CLI_VERSION } from '../update.js'
import { resolveCliSkillResourceDir } from '../skill-resources.js'

type Options = OutputOptions & {
  agent: SkillAgent
  global?: boolean
  project?: string
  yes?: boolean
}
function scoped(command: Command): Command {
  return jsonOption(command)
    .addOption(
      new Option('--agent <agent>', '目标 Agent').choices([...SKILL_AGENTS]).default('universal')
    )
    .addOption(new Option('--project <path>', '项目根目录，默认当前目录').conflicts('global'))
    .option('--global', '操作全局目标')
}

export function registerSkillsCommands(program: Command): void {
  const skills = program.command('skills').description('管理项目或全局 use-loci Skill')
  async function run(
    action: 'list' | 'add' | 'remove' | 'clear',
    name: string | undefined,
    opts: Options
  ) {
    const input = {
      agent: opts.agent,
      project: opts.global ? undefined : (opts.project ?? process.cwd()),
      name
    }
    const result = await withRuntime(async (r) => {
      const manager = new SkillManager({
        database: r.database,
        dataDir: r.dataDir,
        packageVersion: CLI_VERSION,
        skillResourceDir: resolveCliSkillResourceDir()
      })
      if (action === 'list')
        return manager
          .list(input)
          .filter((s) => !opts.global || s.scope === 'global')
          .map(({ name, scope, projectRoot, targetPath, status, requestedAgent }) => ({
            name,
            agent: requestedAgent,
            scope,
            projectRoot,
            targetPath,
            status
          }))
      await confirmWrite(
        `${action} use-loci (${input.agent}, ${input.project ?? '全局'})？`,
        opts.yes
      )
      if (action === 'clear') {
        const summary = await manager.clear(input)
        if (summary.failures.length) process.exitCode = 1
        return summary
      }
      return manager[action](input)
    })
    output(opts, result)
  }
  scoped(skills.command('list').description('查看安装记录')).action((opts: Options) =>
    run('list', undefined, opts)
  )
  scoped(skills.command('clear').description('清空指定范围的 Skill'))
    .option('--yes', '跳过确认')
    .action((opts: Options) => run('clear', undefined, opts))
  for (const action of ['add', 'remove'] as const)
    scoped(
      skills.command(`${action} [name]`).description(action === 'add' ? '安装 Skill' : '移除 Skill')
    )
      .option('--yes', '跳过确认')
      .action((name: string | undefined, opts: Options) => run(action, name, opts))
}
