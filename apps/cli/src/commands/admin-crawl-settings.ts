import type { Command } from 'commander'
import { SERVER_CRAWL_SETTINGS_LIMITS, type ServerCrawlSettings } from '@loci/shared'
import type { CloudAdminClient, LocalRuntime } from '@loci/runtime'
import { CliError } from '../errors.js'
import { printTable } from '../ui.js'
import { formatDomainInterval, parseDomainInterval } from './domain-policy-options.js'

interface CrawlSettingsOptions {
  maxJobs?: number
  http?: number
  browser?: number
  interval?: string
}

type WithAdmin = (
  title: string,
  action: (client: CloudAdminClient, runtime: LocalRuntime) => Promise<string | void>
) => Promise<void>

/** 注册 Server 全局抓取策略命令；hostname 覆盖继续由 domain-* 命令管理。 */
export function registerAdminCrawlSettings(admin: Command, withAdmin: WithAdmin): void {
  admin
    .command('settings')
    .description('查看 Server 全局抓取策略')
    .action(() =>
      withAdmin('Server 全局抓取策略', async (client) => {
        const settings = await client.getCrawlSettings()
        printTable(
          ['最大并行任务', '同域名任务', 'HTTP 并发', '浏览器并发', '批次间隔'],
          [
            [
              settings.maxConcurrentJobs,
              '串行（固定）',
              settings.httpConcurrency,
              settings.browserConcurrency,
              formatDomainInterval(
                settings.batchIntervalMinSeconds,
                settings.batchIntervalMaxSeconds
              )
            ]
          ]
        )
        return `配置修订号：${settings.revision}`
      })
    )

  admin
    .command('settings-set')
    .description('修改 Server 全局抓取策略')
    .option(
      '--max-jobs <number>',
      '最大并行任务数',
      settingInteger('最大并行任务数', SERVER_CRAWL_SETTINGS_LIMITS.maxConcurrentJobs)
    )
    .option(
      '--http <number>',
      '默认 HTTP 并发',
      settingInteger('HTTP 并发', SERVER_CRAWL_SETTINGS_LIMITS.concurrency)
    )
    .option(
      '--browser <number>',
      '默认浏览器并发',
      settingInteger('浏览器并发', SERVER_CRAWL_SETTINGS_LIMITS.concurrency)
    )
    .option('--interval <seconds>', '默认固定间隔或 min-max；0 表示关闭')
    .action((options: CrawlSettingsOptions) =>
      withAdmin('修改 Server 全局抓取策略', async (client) => {
        if (
          options.maxJobs === undefined &&
          options.http === undefined &&
          options.browser === undefined &&
          options.interval === undefined
        ) {
          throw new CliError('至少提供一个要修改的抓取策略选项', 2)
        }
        const current = await client.getCrawlSettings()
        const interval = requiredInterval(options.interval, current)
        const saved = await client.saveCrawlSettings({
          maxConcurrentJobs: options.maxJobs ?? current.maxConcurrentJobs,
          httpConcurrency: options.http ?? current.httpConcurrency,
          browserConcurrency: options.browser ?? current.browserConcurrency,
          batchIntervalMinSeconds: interval[0],
          batchIntervalMaxSeconds: interval[1],
          revision: current.revision
        })
        return `Server 抓取策略已保存（修订号 ${saved.revision}）`
      })
    )
}

function settingInteger(
  label: string,
  limits: { readonly min: number; readonly max: number }
): (value: string) => number {
  return (value) => {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < limits.min || parsed > limits.max) {
      throw new CliError(`${label}必须是 ${limits.min} 到 ${limits.max} 之间的整数`, 2)
    }
    return parsed
  }
}

function requiredInterval(
  value: string | undefined,
  current: ServerCrawlSettings
): [number, number] {
  const interval = parseDomainInterval(value, current)
  if (interval[0] === null || interval[1] === null) {
    throw new CliError('Server 全局批次间隔不能使用 default', 2)
  }
  return [interval[0], interval[1]]
}
