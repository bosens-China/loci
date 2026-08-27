import type { Command } from 'commander'
import {
  APP_SETTINGS_LIMITS,
  isValidBatchIntervalRange,
  isValidBatchIntervalSeconds,
  normalizeServerUrl,
  type AppSettings
} from '@loci/shared'
import { runWithRuntime } from '../command-runtime.js'
import { CliError } from '../errors.js'
import { askConfirm, askInteger, askSelect, askText, note, printTable } from '../ui.js'
import { registerDomainPolicyCommands } from './config-domain.js'

type ConfigKey =
  | 'http-concurrency'
  | 'browser-concurrency'
  | 'max-retries'
  | 'batch-interval-seconds'
  | 'github-archive-limit-mb'
  | 'github-markdown-limit-mb'
  | 'server-url'

export function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('查看和修改 Loci 本地设置')
  registerDomainPolicyCommands(config)

  config
    .command('list')
    .description('显示 CLI 支持的共享设置')
    .action(() =>
      runWithRuntime('共享设置', async (runtime) => {
        const settings = runtime.database.getSettings()
        const serverUrlOverride = process.env.LOCI_SERVER_URL?.trim()
        printTable(
          ['设置', '当前值'],
          [
            ['http-concurrency', settings.httpConcurrency],
            ['browser-concurrency', settings.browserConcurrency],
            ['max-retries', settings.maxRetries],
            ['batch-interval-seconds', configValue(settings, 'batch-interval-seconds')],
            ['github-archive-limit-mb', settings.githubArchiveLimitMb],
            ['github-markdown-limit-mb', settings.githubMarkdownLimitMb],
            [
              'server-url',
              serverUrlOverride
                ? `${settings.serverUrl}（由 LOCI_SERVER_URL 覆盖）`
                : settings.serverUrl
            ]
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
        if (selected === 'server-url' && process.env.LOCI_SERVER_URL?.trim()) {
          throw new CliError(
            'LOCI_SERVER_URL 正在覆盖 Server 地址；请先取消该环境变量，再运行 config set server-url',
            2
          )
        }
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
      'http-concurrency',
      'browser-concurrency',
      'max-retries',
      'batch-interval-seconds',
      'github-archive-limit-mb',
      'github-markdown-limit-mb',
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
  if (key === 'max-retries') return range(APP_SETTINGS_LIMITS.maxRetries)
  if (key === 'github-archive-limit-mb' || key === 'github-markdown-limit-mb') {
    return range(APP_SETTINGS_LIMITS.githubSizeMb)
  }
  return range(APP_SETTINGS_LIMITS.concurrency)
}

function range(value: { readonly min: number; readonly max: number }): [number, number] {
  return [value.min, value.max]
}

function configValue(settings: AppSettings, key: ConfigKey): string {
  if (key === 'http-concurrency') return String(settings.httpConcurrency)
  if (key === 'browser-concurrency') return String(settings.browserConcurrency)
  if (key === 'max-retries') return String(settings.maxRetries)
  if (key === 'batch-interval-seconds') {
    return formatBatchIntervalRange(settings.batchIntervalSeconds, settings.batchIntervalMaxSeconds)
  }
  if (key === 'github-archive-limit-mb') return String(settings.githubArchiveLimitMb)
  if (key === 'github-markdown-limit-mb') return String(settings.githubMarkdownLimitMb)
  return settings.serverUrl
}

function applyConfigValue(settings: AppSettings, key: ConfigKey, value: string): void {
  if (key === 'server-url') settings.serverUrl = value
  if (key === 'http-concurrency') settings.httpConcurrency = Number(value)
  if (key === 'browser-concurrency') settings.browserConcurrency = Number(value)
  if (key === 'max-retries') settings.maxRetries = Number(value)
  if (key === 'batch-interval-seconds') {
    const [minimum, maximum] = parseBatchIntervalRange(value)
    settings.batchIntervalSeconds = minimum
    settings.batchIntervalMaxSeconds = maximum
  }
  if (key === 'github-archive-limit-mb') settings.githubArchiveLimitMb = Number(value)
  if (key === 'github-markdown-limit-mb') settings.githubMarkdownLimitMb = Number(value)
}

function configLabel(key: ConfigKey): string {
  return {
    'http-concurrency': 'HTTP 默认并发',
    'browser-concurrency': '浏览器默认并发',
    'max-retries': '失败重试次数',
    'batch-interval-seconds': '抓取批次间隔',
    'github-archive-limit-mb': 'GitHub ZIP 默认上限（MB）',
    'github-markdown-limit-mb': 'GitHub Markdown 默认上限（MB）',
    'server-url': 'Loci Server 地址'
  }[key]
}

export function formatBatchIntervalHint(value: string): string {
  let range: [number, number]
  try {
    range = parseBatchIntervalRange(value)
  } catch {
    return `允许 ${APP_SETTINGS_LIMITS.batchIntervalSeconds.disabled}（不等待），或 ${APP_SETTINGS_LIMITS.batchIntervalSeconds.min} 到 ${APP_SETTINGS_LIMITS.batchIntervalSeconds.max} 之间的整数秒`
  }
  const [minimum, maximum] = range
  if (minimum === 0 && maximum === 0) return '0 表示批次之间不额外等待'
  if (minimum === maximum) return `每个抓取批次之间固定等待 ${minimum} 秒`
  return `每个批次结束后随机等待 ${minimum} 到 ${maximum} 秒`
}

function normalizeConfigValue(key: ConfigKey, value: string): string {
  if (key === 'server-url') return normalizeServerUrl(value)
  if (key === 'batch-interval-seconds') {
    const [minimum, maximum] = parseBatchIntervalRange(value)
    return formatBatchIntervalRange(minimum, maximum)
  }
  const number = Number(value)
  if (!Number.isInteger(number)) throw new CliError(`${configLabel(key)}必须是整数`, 2)
  return String(number)
}

function validateBatchInterval(value: string | undefined): string | undefined {
  try {
    parseBatchIntervalRange(value ?? '')
    return undefined
  } catch {
    return `批次间隔必须为 0、单个 ${APP_SETTINGS_LIMITS.batchIntervalSeconds.min}–${APP_SETTINGS_LIMITS.batchIntervalSeconds.max} 整数，或 min-max 区间`
  }
}

export function parseBatchIntervalRange(value: string): [number, number] {
  const parts = value.trim().split(/\s*-\s*/u)
  if (parts.length < 1 || parts.length > 2 || parts.some((part) => part === '')) {
    throw new CliError('批次间隔格式应为单个秒数或 min-max 区间', 2)
  }
  const minimum = Number(parts[0])
  const maximum = Number(parts[1] ?? parts[0])
  if (
    !isValidBatchIntervalSeconds(minimum) ||
    !isValidBatchIntervalSeconds(maximum) ||
    !isValidBatchIntervalRange(minimum, maximum)
  ) {
    throw new CliError('批次间隔超出允许范围或区间顺序不正确', 2)
  }
  return [minimum, maximum]
}

function formatBatchIntervalRange(minimum: number, maximum: number): string {
  if (minimum === 0 && maximum !== 0) return String(maximum)
  if (maximum === 0 || minimum === maximum) return String(minimum)
  return `${minimum}-${maximum}`
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
    'http-concurrency',
    'browser-concurrency',
    'max-retries',
    'batch-interval-seconds',
    'github-archive-limit-mb',
    'github-markdown-limit-mb',
    'server-url'
  ].includes(value)
}
