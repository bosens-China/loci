import type { Command } from 'commander'
import type { SaveHostnameCrawlPolicyInput } from '@loci/shared'
import { runWithRuntime } from '../command-runtime.js'
import { confirmAction, printTable } from '../ui.js'
import {
  formatDomainInterval,
  parseDomainConcurrency,
  parseDomainInterval
} from './domain-policy-options.js'

type DomainOptions = {
  http?: string
  browser?: string
  interval?: string
}

export function registerDomainPolicyCommands(config: Command): void {
  config
    .command('domain-list')
    .description('列出 hostname 自定义抓取限制')
    .action(() =>
      runWithRuntime('域名抓取限制', async (runtime) => {
        const rows = runtime.database.listHostnameCrawlPolicies()
        printTable(
          ['hostname', 'HTTP 并发', '浏览器并发', '批次间隔', '更新时间'],
          rows.map((item) => [
            item.hostname,
            item.httpConcurrency ?? '默认',
            item.browserConcurrency ?? '默认',
            formatDomainInterval(item.batchIntervalMinSeconds, item.batchIntervalMaxSeconds),
            item.updatedAt
          ])
        )
        return `共 ${rows.length} 条域名规则`
      })
    )

  config
    .command('domain-set <hostname>')
    .description('新增或实时修改 hostname 抓取限制')
    .option('--http <number>', 'HTTP 并发；default 表示继承全局')
    .option('--browser <number>', '浏览器并发；default 表示继承全局')
    .option('--interval <seconds>', '批次间隔：固定值、min-max 或 default')
    .action((hostname: string, options: DomainOptions) =>
      runWithRuntime('保存域名抓取限制', async (runtime) => {
        runtime.assertWritable()
        const current = runtime.database.getHostnameCrawlPolicy(hostname)
        const interval = parseDomainInterval(options.interval, current)
        const input: SaveHostnameCrawlPolicyInput = {
          hostname,
          httpConcurrency: parseDomainConcurrency(options.http, current?.httpConcurrency ?? null),
          browserConcurrency: parseDomainConcurrency(
            options.browser,
            current?.browserConcurrency ?? null
          ),
          batchIntervalMinSeconds: interval[0],
          batchIntervalMaxSeconds: interval[1]
        }
        const saved = runtime.database.saveHostnameCrawlPolicy(input)
        return `已保存 ${saved.hostname} 的抓取限制并实时生效`
      })
    )

  config
    .command('domain-delete <hostname>')
    .description('删除 hostname 自定义规则并恢复全局默认')
    .option('--yes', '跳过确认')
    .action((hostname: string, options: { yes?: boolean }) =>
      runWithRuntime('删除域名抓取限制', async (runtime) => {
        runtime.assertWritable()
        if (
          !(await confirmAction(
            `确认删除 ${hostname} 的自定义限制吗？`,
            options.yes,
            '非交互终端请传入 --yes 跳过删除确认'
          ))
        ) {
          return '未删除域名规则'
        }
        return runtime.database.deleteHostnameCrawlPolicy(hostname)
          ? `已删除 ${hostname} 的自定义限制`
          : `未找到 ${hostname} 的自定义限制`
      })
    )
}
