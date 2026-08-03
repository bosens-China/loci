import type { Command } from 'commander'
import type { CloudLibrary, CloudLibraryInput } from '@loci/shared'
import { runWithRuntime } from '../command-runtime.js'
import { CliError, errorMessage } from '../errors.js'
import {
  askConfirm,
  askPassword,
  askSelect,
  askText,
  createSpinner,
  failure,
  printTable,
  success,
  warning
} from '../ui.js'

type AdminAction = 'list' | 'create' | 'update' | 'delete' | 'sync' | 'exit'

export function registerAdminCommand(program: Command): void {
  program
    .command('admin')
    .description('进入 Loci Server 管理员交互会话')
    .action(() =>
      runWithRuntime('Loci Server 管理员', async (runtime) => {
        const settings = runtime.database.getSettings()
        const username = await askText('管理员账号')
        const password = await askPassword('管理员密码')
        const spinner = createSpinner()
        spinner.start(`正在登录 ${settings.serverUrl}`)
        try {
          await runtime.admin.login(settings.serverUrl, { username, password })
          spinner.stop(`已登录：${username}`)
        } catch (error) {
          spinner.error('登录失败')
          throw error
        }

        try {
          await adminLoop(runtime.admin)
        } finally {
          await runtime.admin.logout().catch(() => undefined)
        }
        return '管理员会话已结束，登录信息已清除'
      })
    )
}

async function adminLoop(
  client: import('../../../desktop/src/main/cloud-admin-client.js').CloudAdminClient
): Promise<void> {
  let running = true
  while (running) {
    const action = await askSelect<AdminAction>('请选择管理操作', [
      { value: 'list', label: '查看 Server 文档库' },
      { value: 'create', label: '创建 Server 文档库' },
      { value: 'update', label: '修改文档库与计划' },
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
        const library = await client.createLibrary(await askLibraryInput())
        success(`已创建“${library.name}”`)
      }
      if (action === 'update') {
        const current = await selectLibrary(await client.listLibraries())
        const library = await client.updateLibrary(current.id, await askLibraryInput(current))
        success(`已更新“${library.name}”`)
      }
      if (action === 'delete') {
        const current = await selectLibrary(await client.listLibraries())
        if (await askConfirm(`确定删除“${current.name}”及其已发布快照吗？`)) {
          await client.deleteLibrary(current.id)
          success(`已删除“${current.name}”`)
        }
      }
      if (action === 'sync') {
        const current = await selectLibrary(await client.listLibraries())
        await syncLibrary(client, current)
      }
    } catch (error) {
      failure(errorMessage(error))
    }
  }
}

async function syncLibrary(
  client: import('../../../desktop/src/main/cloud-admin-client.js').CloudAdminClient,
  library: CloudLibrary
): Promise<void> {
  let job = await client.syncLibrary(library.id)
  const spinner = createSpinner()
  spinner.start(`正在同步“${library.name}”`)
  while (job.status === 'queued' || job.status === 'running') {
    if (job.progress) {
      spinner.message(
        `已处理 ${job.progress.processed}/${job.progress.queued}，成功 ${job.progress.succeeded}，失败 ${job.progress.failed}`
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    job = await client.getSyncJob(job.id)
  }
  if (job.status === 'completed') spinner.stop('同步成功')
  else if (job.status === 'completed_with_errors') {
    spinner.stop('同步完成')
    warning(`${job.failures.length} 个页面失败，请检查 Server 任务记录`)
  } else {
    spinner.error('同步失败')
    throw new CliError(job.error ?? 'Server 同步失败')
  }
}

async function askLibraryInput(current?: CloudLibrary): Promise<CloudLibraryInput> {
  const name = await askText('名称', { initialValue: current?.name })
  const url = await askText('第一个页面 URL', { initialValue: current?.url })
  const pageLimit = Number(
    await askText('页面上限', { initialValue: String(current?.pageLimit ?? 1000) })
  )
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 10_000) {
    throw new CliError('页面上限必须是 1 到 10000 之间的整数', 2)
  }
  const schedule = await askText('抓取计划（留空表示关闭）', {
    initialValue: current?.schedule ?? '',
    required: false
  })
  return {
    name,
    url,
    pageLimit,
    schedule: schedule || null
  }
}

async function selectLibrary(libraries: CloudLibrary[]): Promise<CloudLibrary> {
  if (libraries.length === 0) throw new CliError('Server 还没有文档库')
  const id = await askSelect(
    '请选择 Server 文档库',
    libraries.map((library) => ({
      value: library.id,
      label: library.name,
      hint: `${library.pages} 页${library.schedule ? `，计划 ${library.schedule}` : ''}`
    }))
  )
  return libraries.find((library) => library.id === id)!
}

function printLibraries(libraries: CloudLibrary[]): void {
  printTable(
    ['名称', '页面', '计划', '发布状态', '短 ID'],
    libraries.map((library) => [
      library.name,
      library.pages,
      library.schedule ?? '关闭',
      library.publishedAt ? '已发布' : '未发布',
      library.id.slice(0, 8)
    ])
  )
  success(`共 ${libraries.length} 个 Server 文档库`)
}
