import type { Command } from 'commander'
import { SERVER_CRAWL_SETTINGS_LIMITS } from '@loci/shared'
import type { CloudAdminClient, LocalRuntime } from '@loci/runtime'
import { CliError } from '../errors.js'
import { printTable } from '../ui.js'

interface CrawlSettingsOptions {
  maxJobs?: number
}

type WithAdmin = (
  title: string,
  action: (client: CloudAdminClient, runtime: LocalRuntime) => Promise<string | void>
) => Promise<void>

/** 注册 Server 任务容量命令，页面执行参数由共享底层管理。 */
export function registerAdminCrawlSettings(admin: Command, withAdmin: WithAdmin): void {
  admin
    .command('settings')
    .description('查看 Server 全局抓取策略')
    .action(() =>
      withAdmin('Server 全局抓取策略', async (client) => {
        const settings = await client.getCrawlSettings()
        printTable(['最大并行任务', '同域名任务'], [[settings.maxConcurrentJobs, '串行（固定）']])
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
    .action((options: CrawlSettingsOptions) =>
      withAdmin('修改 Server 全局抓取策略', async (client) => {
        if (options.maxJobs === undefined) throw new CliError('请提供 --max-jobs', 2)
        const current = await client.getCrawlSettings()
        const saved = await client.saveCrawlSettings({
          maxConcurrentJobs: options.maxJobs ?? current.maxConcurrentJobs,
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
