import { listAgentClients, type AgentIntegrationStatus } from '@loci/shared'
import type { Command } from 'commander'
import { jsonOption, output, withRuntime, type OutputOptions } from '../command-runtime.js'
import type { CliRuntime } from '../runtime.js'
import { confirmWrite, selectClient } from '../ui.js'

function service(runtime: CliRuntime) {
  if (!runtime.agentIntegration) throw new Error('Agent 接入资源不可用')
  return runtime.agentIntegration
}
async function client(ref?: string) {
  return ref ?? selectClient(listAgentClients().map(({ id, label }) => ({ value: id, label })))
}
function summary({ client, overall, components }: AgentIntegrationStatus) {
  return {
    client,
    overall,
    components: components.map(({ component, status, path, message, backupPath }) => ({
      component,
      status,
      path,
      ...(message && { message }),
      ...(backupPath && { backupPath })
    }))
  }
}

export function registerSetupCommand(program: Command): void {
  const setup = jsonOption(
    program.command('setup [client]').description('同步 Agent 的全局 use-loci Skill 和 Rules')
  )
  setup.action(async (ref: string | undefined, opts: OutputOptions) => {
    const target = await client(ref)
    const result = await withRuntime((r) => service(r).setup(target))
    if (result.status.overall === 'attention') process.exitCode = 1
    output(opts, { changed: result.changed, ...summary(result.status) })
  })
  jsonOption(setup.command('status [client]').description('查看全局接入状态')).action(
    async (ref: string | undefined, opts: OutputOptions) => {
      const result = await withRuntime((r) =>
        ref === undefined ? service(r).list().map(summary) : summary(service(r).inspect(ref))
      )
      output(opts, result)
    }
  )
  for (const action of ['remove', 'rules'] as const) {
    jsonOption(
      setup
        .command(`${action} [client]`)
        .description(action === 'rules' ? '同步全局 Rules' : '移除全局接入')
    )
      .option('--yes', '跳过确认')
      .action(async (ref: string | undefined, opts: OutputOptions & { yes?: boolean }) => {
        const target = await client(ref)
        await confirmWrite(
          `${action === 'rules' ? '同步 Rules' : '移除 Skill 和 Rules'} (${target})？`,
          opts.yes
        )
        const result = await withRuntime(async (r) => {
          if (action === 'rules') return service(r).setupRules(target)
          const result = await service(r).remove(target)
          if (result.status.components.some((item) => item.status === 'conflict'))
            process.exitCode = 1
          return { changed: result.changed, ...summary(result.status) }
        })
        output(opts, result)
      })
  }
}
