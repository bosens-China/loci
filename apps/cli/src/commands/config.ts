import { DEFAULT_APP_SETTINGS, type AppSettings } from '@loci/shared'
import type { Command } from 'commander'
import { jsonOption, natural, output, withRuntime, type OutputOptions } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { confirmWrite } from '../ui.js'

const keys = Object.keys(DEFAULT_APP_SETTINGS) as (keyof AppSettings)[]
const flag = (key: string) => key.replace(/[A-Z]/gu, (s) => '-' + s.toLowerCase())
function override(value: string): number | null {
  return value === 'inherit' ? null : natural(value)
}
interface DomainOptions extends OutputOptions {
  httpConcurrency?: string
  browserConcurrency?: string
  batchIntervalMinSeconds?: string
  batchIntervalMaxSeconds?: string
}

export function registerConfigCommands(program: Command): void {
  const config = jsonOption(program.command('config').description('查看和修改本地配置及域名策略'))
  const list = async (opts: OutputOptions) =>
    output(opts, await withRuntime((r) => r.database.getSettings()))
  config.action(list)
  jsonOption(config.command('list').description('显示本地设置')).action(list)
  jsonOption(
    config.command('set <key> <value>').description(`设置 ${keys.map(flag).join('、')}`)
  ).action(async (name: string, value: string, opts: OutputOptions) => {
    const key = keys.find((k) => k === name || flag(k) === name)
    if (!key) throw new CliError(`未知设置：${name}`, 2)
    const result = await withRuntime((r) =>
      r.patchAppSettings({
        [key]: key === 'theme' ? value : natural(value)
      })
    )
    output(opts, { [name]: result[key] })
  })
  const domain = config.command('domain').description('管理域名抓取策略')
  jsonOption(domain.command('list').description('显示域名策略')).action(
    async (opts: OutputOptions) =>
      output(opts, await withRuntime((r) => r.database.listHostnameCrawlPolicies()))
  )
  jsonOption(domain.command('set <hostname>').description('更新域名策略，inherit 表示继承全局设置'))
    .option('--http-concurrency <n|inherit>', 'HTTP 并发')
    .option('--browser-concurrency <n|inherit>', '浏览器并发')
    .option('--batch-interval-min-seconds <n|inherit>', '最小批次间隔')
    .option('--batch-interval-max-seconds <n|inherit>', '最大批次间隔')
    .action(async (hostname: string, opts: DomainOptions) => {
      const { json, ...values } = opts
      const patch = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, override(value)])
      )
      const result = await withRuntime((r) => r.patchHostnamePolicy(hostname, patch))
      output({ json }, result)
    })
  jsonOption(domain.command('remove <hostname>').description('删除域名策略'))
    .option('--yes', '跳过确认')
    .action(async (hostname: string, opts: OutputOptions & { yes?: boolean }) => {
      await confirmWrite(`删除「${hostname}」的域名策略并恢复继承全局设置？`, opts.yes)
      output(opts, { deleted: await withRuntime((r) => r.deleteHostnameCrawlPolicy(hostname)) })
    })
}
