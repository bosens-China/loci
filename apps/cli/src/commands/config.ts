import type { Command } from 'commander'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { askSelect, askText, printTable } from '../ui.js'

type ConfigKey =
  | 'mcp-port'
  | 'http-concurrency'
  | 'browser-concurrency'
  | 'max-retries'
  | 'batch-interval-seconds'
  | 'server-url'

export function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('查看和修改桌面端与 CLI 共享设置')

  config
    .command('list')
    .description('显示 CLI 支持的共享设置')
    .action(() =>
      runWithRuntime('共享设置', async (runtime) => {
        const settings = runtime.database.getSettings()
        printTable(
          ['设置', '当前值'],
          [
            ['mcp-port', settings.mcpPort],
            ['http-concurrency', settings.httpConcurrency],
            ['browser-concurrency', settings.browserConcurrency],
            ['max-retries', settings.maxRetries],
            ['batch-interval-seconds', settings.batchIntervalSeconds],
            ['server-url', settings.serverUrl]
          ]
        )
        return '共享设置读取成功'
      })
    )

  config
    .command('set [key] [value]')
    .description('修改一个共享设置')
    .action((key: ConfigKey | undefined, value: string | undefined) =>
      runWithRuntime('修改共享设置', async (runtime) => {
        runtime.assertWritable()
        const selected =
          key ??
          (await askSelect<ConfigKey>('请选择设置', [
            { value: 'mcp-port', label: 'MCP 端口' },
            { value: 'http-concurrency', label: 'HTTP 默认并发' },
            { value: 'browser-concurrency', label: '浏览器默认并发' },
            { value: 'max-retries', label: '失败重试次数' },
            { value: 'batch-interval-seconds', label: '抓取批次间隔（秒）' },
            { value: 'server-url', label: 'Loci Server 地址' }
          ]))
        if (!isConfigKey(selected)) throw new CliError(`不支持的设置：${selected}`, 2)
        const input = value ?? (await askText(`请输入 ${selected} 的新值`))
        const settings = runtime.database.getSettings()
        if (selected === 'server-url') settings.serverUrl = input
        else {
          const number = Number(input)
          if (!Number.isInteger(number)) throw new CliError(`${selected} 必须是整数`, 2)
          if (selected === 'mcp-port') settings.mcpPort = number
          if (selected === 'http-concurrency') settings.httpConcurrency = number
          if (selected === 'browser-concurrency') settings.browserConcurrency = number
          if (selected === 'max-retries') settings.maxRetries = number
          if (selected === 'batch-interval-seconds') settings.batchIntervalSeconds = number
        }
        runtime.database.saveSettings(settings)
        return `已将 ${selected} 设置为 ${input}`
      })
    )
}

function isConfigKey(value: string): value is ConfigKey {
  return [
    'mcp-port',
    'http-concurrency',
    'browser-concurrency',
    'max-retries',
    'batch-interval-seconds',
    'server-url'
  ].includes(value)
}
