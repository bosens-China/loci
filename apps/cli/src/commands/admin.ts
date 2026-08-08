import type { Command } from 'commander'
import { DOCUMENT_SOURCE_DEFAULTS, DOCUMENT_SOURCE_LIMITS } from '@loci/core'
import {
  SCHEDULE_PRESETS,
  deriveSourceName,
  getSchedulePreset,
  getUpcomingScheduleRuns,
  normalizeCronSchedule,
  type CloudLibrary,
  type CloudLibraryInput
} from '@loci/shared'
import type { CloudAdminClient, LociDatabase } from '@loci/runtime'
import { runWithRuntime } from '../command-runtime.js'
import { CliCanceledError, CliError, errorMessage } from '../errors.js'
import { validatePublicUrl, validateSourceName } from '../input.js'
import {
  readAdminCreatePreference,
  readAdminSyncSelection,
  readAdminUsername,
  saveAdminCreatePreference,
  saveAdminSyncSelection,
  saveAdminUsername,
  scopeAtDepth,
  scopeDepth,
  type AdminCreatePreference
} from '../preferences.js'
import { askScope } from './source.js'
import { registerAdminSubcommands } from './admin-script.js'
import { selectLibraries, syncLibraries } from './admin-sync.js'
import {
  askConfirm,
  askInteger,
  askPassword,
  askSelect,
  askText,
  createSpinner,
  failure,
  info,
  note,
  printTable,
  success,
  warning
} from '../ui.js'

type AdminAction = 'list' | 'create' | 'update' | 'schedule' | 'delete' | 'sync' | 'exit'

const MANUAL_SCHEDULE = 'manual'
const CUSTOM_SCHEDULE = 'custom'
const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

export function registerAdminCommand(program: Command): void {
  const admin = program
    .command('admin')
    .description('管理 Loci Server 文档库；不带子命令进入交互会话')
  admin.action(() =>
    runWithRuntime('Loci Server 管理员', async (runtime) => {
      const settings = runtime.database.getSettings()
      const username = await askText('管理员账号', {
        initialValue: readAdminUsername(runtime.database, settings.serverUrl)
      })
      const password = await askPassword('管理员密码')
      const spinner = createSpinner()
      spinner.start(`正在登录 ${settings.serverUrl}`)
      try {
        await runtime.admin.login(settings.serverUrl, { username, password })
        saveAdminUsername(runtime.database, settings.serverUrl, username)
        spinner.stop(`已登录：${username}`)
      } catch (error) {
        spinner.error('登录失败')
        throw error
      }

      try {
        await adminLoop(runtime.admin, runtime.database, settings.serverUrl)
      } finally {
        await runtime.admin.logout().catch(() => undefined)
      }
      return '管理员会话已结束，登录信息已清除'
    })
  )
  registerAdminSubcommands(admin, syncLibraries)
}

async function adminLoop(
  client: CloudAdminClient,
  database: LociDatabase,
  serverUrl: string
): Promise<void> {
  let running = true
  while (running) {
    const action = await askSelect<AdminAction>('请选择管理操作', [
      { value: 'list', label: '查看 Server 文档库' },
      { value: 'create', label: '创建 Server 文档库' },
      { value: 'update', label: '修改文档库基础信息' },
      { value: 'schedule', label: '设置自动更新计划' },
      { value: 'delete', label: '删除 Server 文档库' },
      { value: 'sync', label: '手动同步文档库' },
      { value: 'exit', label: '退出管理员会话' }
    ])
    if (action === 'exit') {
      running = false
      continue
    }
    try {
      if (action === 'list') printLibraries(await client.listLibraries())
      if (action === 'create') {
        const input = await askLibraryInput(readAdminCreatePreference(database, serverUrl))
        note(formatLibrarySummary(input), '请确认创建配置')
        if (!(await askConfirm('确认创建这个 Server 文档库吗？', true))) {
          warning('已取消创建')
          continue
        }
        const library = await client.createLibrary(input)
        saveAdminCreatePreference(database, serverUrl, {
          pageLimit: input.pageLimit,
          scopeDepth: scopeDepth(input.url, input.scopePath),
          schedule: input.schedule
        })
        success(`已创建“${library.name}”；可选择手动同步进行首次发布`)
      }
      if (action === 'update') {
        const current = await selectLibrary(await client.listLibraries())
        const input = { ...(await askLibraryBasics(current)), schedule: current.schedule }
        if (sameLibraryInput(current, input)) {
          info('基础信息没有变化')
          continue
        }
        if (current.url !== input.url) {
          warning('起始 URL 已变化，Server 会清空现有抓取内容，需要重新同步后再发布')
        }
        note(formatLibraryChanges(current, input), '请确认基础信息变更')
        if (!(await askConfirm('确认保存这些修改吗？', true))) {
          warning('已取消修改')
          continue
        }
        const library = await client.updateLibrary(current.id, input)
        success(`已更新“${library.name}”`)
      }
      if (action === 'schedule') {
        const current = await selectLibrary(await client.listLibraries())
        const schedule = await askSchedule(current.schedule)
        if (schedule === current.schedule) {
          info('自动更新计划没有变化')
          continue
        }
        note(
          `原计划：${formatScheduleLabel(current.schedule)}\n新计划：${formatSchedulePreview(schedule)}`,
          '请确认计划变更'
        )
        if (!(await askConfirm('确认更新自动更新计划吗？', true))) {
          warning('已取消修改')
          continue
        }
        const library = await client.updateLibrary(current.id, {
          name: current.name,
          url: current.url,
          scopePath: current.scopePath,
          pageLimit: current.pageLimit,
          schedule
        })
        success(`已更新“${library.name}”的自动更新计划`)
      }
      if (action === 'delete') {
        const current = await selectLibrary(await client.listLibraries())
        if (await askConfirm(`确定删除“${current.name}”及其已发布快照吗？`)) {
          await client.deleteLibrary(current.id)
          success(`已删除“${current.name}”`)
        }
      }
      if (action === 'sync') {
        const selected = await selectLibraries(
          await client.listLibraries(),
          readAdminSyncSelection(database, serverUrl)
        )
        await syncLibraries(client, selected)
        saveAdminSyncSelection(
          database,
          serverUrl,
          selected.map((library) => library.id)
        )
      }
    } catch (error) {
      if (error instanceof CliCanceledError) continue
      failure(errorMessage(error))
    }
  }
}

export async function askLibraryInput(
  preference: AdminCreatePreference = {
    pageLimit: DOCUMENT_SOURCE_DEFAULTS.pageLimit,
    scopeDepth: 0,
    schedule: DOCUMENT_SOURCE_DEFAULTS.schedule
  }
): Promise<CloudLibraryInput> {
  return {
    ...(await askLibraryBasics(undefined, preference)),
    schedule: await askSchedule(preference.schedule)
  }
}

async function askLibraryBasics(
  current?: CloudLibrary,
  preference: Pick<AdminCreatePreference, 'pageLimit' | 'scopeDepth'> = {
    pageLimit: DOCUMENT_SOURCE_DEFAULTS.pageLimit,
    scopeDepth: 0
  }
): Promise<Omit<CloudLibraryInput, 'schedule'>> {
  const url = await askText('起始页面 URL', {
    initialValue: current?.url,
    placeholder: 'https://example.com/docs/start',
    validate: validatePublicUrl
  })
  const inferredName = deriveSourceName(url) || new URL(url).hostname
  const name = await askText('文档源名称', {
    initialValue: current?.name ?? inferredName,
    validate: validateSourceName
  })
  const scopePath = await askScope(
    url,
    current?.scopePath ?? scopeAtDepth(url, preference.scopeDepth)
  )
  const pageLimit = await askInteger('收录页面上限', {
    initialValue: current?.pageLimit ?? preference.pageLimit,
    minimum: DOCUMENT_SOURCE_LIMITS.pageLimit.min,
    maximum: DOCUMENT_SOURCE_LIMITS.pageLimit.max
  })
  return { name, url, scopePath, pageLimit }
}

export async function askSchedule(current: string | null): Promise<string | null> {
  const preset = current ? getSchedulePreset(current) : null
  const choice = await askSelect<string>(
    '自动更新计划',
    [
      { value: MANUAL_SCHEDULE, label: '仅手动更新', hint: '关闭定时同步' },
      ...SCHEDULE_PRESETS.map((item) => ({
        value: item.expression,
        label: item.label,
        hint: item.description
      })),
      { value: CUSTOM_SCHEDULE, label: '自定义高级周期', hint: '输入 5 段 Linux Cron' }
    ],
    current ? (preset?.expression ?? CUSTOM_SCHEDULE) : MANUAL_SCHEDULE
  )
  if (choice === MANUAL_SCHEDULE) return null
  if (choice !== CUSTOM_SCHEDULE) return normalizeCronSchedule(choice)

  const expression = await askText('自定义 Cron（分 时 日 月 周）', {
    initialValue: current && !preset ? current : '0 2 * * *',
    placeholder: '0 2 * * *',
    validate: validateSchedule,
    liveHint: formatScheduleLiveHint
  })
  return normalizeCronSchedule(expression)
}

async function selectLibrary(libraries: CloudLibrary[]): Promise<CloudLibrary> {
  if (libraries.length === 0) throw new CliError('Server 还没有文档库')
  if (libraries.length === 1) return libraries[0]!
  const id = await askSelect(
    '请选择 Server 文档库',
    libraries.map((library) => ({
      value: library.id,
      label: library.name,
      hint: `${library.hostname} · ${library.pages} 页 · ${formatScheduleLabel(library.schedule)}`
    }))
  )
  return libraries.find((library) => library.id === id)!
}

function printLibraries(libraries: CloudLibrary[]): void {
  if (libraries.length === 0) {
    info('Server 还没有文档库，可选择“创建 Server 文档库”开始')
    return
  }
  printTable(
    ['名称', '范围', '页面', '计划', '发布状态', '最近同步', '错误', '短 ID'],
    libraries.map((library) => [
      library.name,
      library.scopePath,
      library.pages,
      formatScheduleLabel(library.schedule),
      library.publishedAt ? '已发布' : '未发布',
      library.lastCrawledAt ?? '—',
      library.lastError ?? '—',
      library.id.slice(0, 8)
    ])
  )
  success(`共 ${libraries.length} 个 Server 文档库`)
}

export function formatScheduleLiveHint(value: string): string {
  if (!value.trim()) return '格式：分 时 日 月 周，例如每天 02:00 为 0 2 * * *'
  try {
    const runs = getUpcomingScheduleRuns(value, 2)
    return runs.length === 2
      ? `预计下次：${dateTimeFormatter.format(runs[0])}；再下次：${dateTimeFormatter.format(runs[1])}`
      : '当前表达式没有可执行的后续时间'
  } catch {
    return '继续输入有效的 5 段 Cron，底部会实时显示最近两次执行时间'
  }
}

function validateSchedule(value: string | undefined): string | undefined {
  try {
    normalizeCronSchedule(value)
    return undefined
  } catch (error) {
    return errorMessage(error)
  }
}

function formatScheduleLabel(schedule: string | null): string {
  if (!schedule) return '仅手动'
  return getSchedulePreset(schedule)?.label ?? schedule
}

function formatSchedulePreview(schedule: string | null): string {
  if (!schedule) return '仅手动更新，不执行定时同步'
  const preset = getSchedulePreset(schedule)
  return `${preset ? `${preset.label} · ${preset.description}` : schedule}\n${formatScheduleLiveHint(schedule)}`
}

function formatLibrarySummary(input: CloudLibraryInput): string {
  return [
    `名称：${input.name}`,
    `URL：${input.url}`,
    `收录范围：${input.scopePath}`,
    `页面上限：${input.pageLimit}`,
    `更新计划：${formatSchedulePreview(input.schedule)}`
  ].join('\n')
}

function formatLibraryChanges(current: CloudLibrary, input: CloudLibraryInput): string {
  const changes = [
    current.name === input.name ? null : `名称：${current.name} → ${input.name}`,
    current.url === input.url ? null : `URL：${current.url} → ${input.url}`,
    current.scopePath === input.scopePath
      ? null
      : `收录范围：${current.scopePath} → ${input.scopePath}`,
    current.pageLimit === input.pageLimit
      ? null
      : `页面上限：${current.pageLimit} → ${input.pageLimit}`
  ].filter((change): change is string => Boolean(change))
  return changes.join('\n')
}

function sameLibraryInput(current: CloudLibrary, input: CloudLibraryInput): boolean {
  return (
    current.name === input.name &&
    current.url === input.url &&
    current.scopePath === input.scopePath &&
    current.pageLimit === input.pageLimit &&
    current.schedule === input.schedule
  )
}
