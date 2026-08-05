import type { Command } from 'commander'
import { normalizeServerUrl, type AppSettings } from '@loci/shared'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { askConfirm, askInteger, askSelect, askText, note, printTable } from '../ui.js'

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
          (await askSelect<ConfigKey>('请选择设置', configOptions(runtime.database.getSettings())))
        if (!isConfigKey(selected)) throw new CliError(`不支持的设置：${selected}`, 2)
        const settings = runtime.database.getSettings()
        const current = configValue(settings, selected)
        const input = value ?? (await askConfigValue(selected, current))
        const normalized = normalizeConfigValue(selected, input)
        if (normalized === current) return `${configLabel(selected)}保持为 ${current}`
        if (value === undefined) {
          note(`当前值：${current}\n新值：${normalized}`, configLabel(selected))
          if (!(await askConfirm('确认保存这个设置吗？', true))) return '设置未修改'
        }
        applyConfigValue(settings, selected, normalized)
        runtime.database.saveSettings(settings)
        return `已将${configLabel(selected)}设置为 ${normalized}`
      })
    )
}

function configOptions(settings: AppSettings): Array<{
  value: ConfigKey
  label: string
  hint: string
}> {
  return (
    [
      'mcp-port',
      'http-concurrency',
      'browser-concurrency',
      'max-retries',
      'batch-interval-seconds',
      'server-url'
    ] as const
  ).map((value) => ({
    value,
    label: configLabel(value),
    hint: `当前：${configValue(settings, value)}`
  }))
}

async function askConfigValue(key: ConfigKey, current: string): Promise<string> {
  if (key === 'server-url') {
    return askText('Loci Server 地址', {
      initialValue: current,
      placeholder: 'https://loci.example.com',
      validate: validateServerUrl
    })
  }
  if (key === 'batch-interval-seconds') {
    return askText('抓取批次间隔（秒）', {
      initialValue: current,
      validate: validateBatchInterval,
      liveHint: formatBatchIntervalHint
    })
  }
  const [minimum, maximum] = configRange(key)
  return String(
    await askInteger(configLabel(key), {
      initialValue: Number(current),
      minimum,
      maximum
    })
  )
}

function configRange(
  key: Exclude<ConfigKey, 'server-url' | 'batch-interval-seconds'>
): [number, number] {
  if (key === 'mcp-port') return [1024, 65_535]
  if (key === 'max-retries') return [0, 10]
  return [1, 32]
}

function configValue(settings: AppSettings, key: ConfigKey): string {
  if (key === 'mcp-port') return String(settings.mcpPort)
  if (key === 'http-concurrency') return String(settings.httpConcurrency)
  if (key === 'browser-concurrency') return String(settings.browserConcurrency)
  if (key === 'max-retries') return String(settings.maxRetries)
  if (key === 'batch-interval-seconds') return String(settings.batchIntervalSeconds)
  return settings.serverUrl
}

function applyConfigValue(settings: AppSettings, key: ConfigKey, value: string): void {
  if (key === 'server-url') settings.serverUrl = value
  if (key === 'mcp-port') settings.mcpPort = Number(value)
  if (key === 'http-concurrency') settings.httpConcurrency = Number(value)
  if (key === 'browser-concurrency') settings.browserConcurrency = Number(value)
  if (key === 'max-retries') settings.maxRetries = Number(value)
  if (key === 'batch-interval-seconds') settings.batchIntervalSeconds = Number(value)
}

function configLabel(key: ConfigKey): string {
  return {
    'mcp-port': 'MCP 端口',
    'http-concurrency': 'HTTP 默认并发',
    'browser-concurrency': '浏览器默认并发',
    'max-retries': '失败重试次数',
    'batch-interval-seconds': '抓取批次间隔',
    'server-url': 'Loci Server 地址'
  }[key]
}

export function formatBatchIntervalHint(value: string): string {
  const seconds = Number(value)
  if (seconds === 0) return '0 表示批次之间不额外等待'
  if (!Number.isInteger(seconds) || seconds < 100 || seconds > 3000) {
    return '允许 0（不等待），或 100 到 3000 之间的整数秒'
  }
  const minutes = seconds / 60
  const readableMinutes = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1)
  return `每个抓取批次之间等待 ${seconds} 秒（约 ${readableMinutes} 分钟）`
}

function normalizeConfigValue(key: ConfigKey, value: string): string {
  if (key === 'server-url') return normalizeServerUrl(value)
  const number = Number(value)
  if (!Number.isInteger(number)) throw new CliError(`${configLabel(key)}必须是整数`, 2)
  return String(number)
}

function validateBatchInterval(value: string | undefined): string | undefined {
  const number = Number(value)
  return Number.isInteger(number) && (number === 0 || (number >= 100 && number <= 3000))
    ? undefined
    : '批次间隔必须为 0，或 100 到 3000 之间的整数秒'
}

function validateServerUrl(value: string | undefined): string | undefined {
  try {
    normalizeServerUrl(value ?? '')
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : '请输入有效的 Server 地址'
  }
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
