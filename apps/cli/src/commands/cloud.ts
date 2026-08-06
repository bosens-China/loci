import type { Command } from 'commander'
import { formatBytes, type CloudCatalogItem, type DocumentSource } from '@loci/shared'
import type { LociDatabase } from '@loci/runtime'
import { runWithRuntime } from '../command-runtime.js'
import { CliCanceledError, CliError } from '../errors.js'
import { readRecentResource, saveRecentResource } from '../preferences.js'
import { askConfirm, askSelect, createSpinner, printTable } from '../ui.js'

export function registerCloudCommands(program: Command): void {
  const cloud = program.command('cloud').description('使用云端公开文档库')

  cloud
    .command('list')
    .description('列出云端公开文档库及本地状态')
    .action(() =>
      runWithRuntime('云端文档库', async (runtime) => {
        const spinner = createSpinner()
        spinner.start('正在读取云端目录')
        try {
          const items = await runtime.cloud.listCatalog(runtime.database.getSettings().serverUrl)
          spinner.stop('云端目录读取完成')
          printCatalog(items)
          return `共 ${items.length} 个云端文档库`
        } catch (error) {
          spinner.error('云端目录读取失败')
          throw error
        }
      })
    )

  cloud
    .command('pull [library]')
    .description('下载云端文档库到本地')
    .option('--auto-sync', '启用计划运行器每日自动同步')
    .action((reference: string | undefined, options: { autoSync?: boolean }) =>
      runWithRuntime('下载云端文档库', async (runtime) => {
        runtime.assertWritable()
        const serverUrl = runtime.database.getSettings().serverUrl
        const item = await selectCatalog(
          await runtime.cloud.listCatalog(serverUrl),
          reference,
          runtime.database
        )
        const spinner = createSpinner()
        spinner.start(`正在下载“${item.name}”`)
        try {
          const result = await runtime.cloud.importLibrary(
            serverUrl,
            item.id,
            options.autoSync === true
          )
          saveRecentResource(runtime.database, 'cloud-pull', item.id)
          spinner.stop(result.updated ? `已保存 ${result.documents} 篇文档` : '本地已经是最新版本')
          return result.updated ? `云端文档库“${item.name}”下载成功` : `“${item.name}”无需更新`
        } catch (error) {
          spinner.error('下载失败')
          throw error
        }
      })
    )

  cloud
    .command('auto-sync [library] [state]')
    .description('开启或关闭本地云端副本的每日自动同步')
    .action((reference: string | undefined, state: string | undefined) =>
      runWithRuntime('云端副本自动同步', async (runtime) => {
        runtime.assertWritable()
        const source = await selectCloudSource(
          runtime.database.listSources(),
          reference,
          runtime.database,
          'cloud-auto-sync'
        )
        const enabled = state
          ? parseAutoSyncState(state)
          : await askConfirm('启用每日自动同步？', true)
        runtime.cloud.setAutoSync(source.id, runtime.database.getSettings().serverUrl, enabled)
        saveRecentResource(runtime.database, 'cloud-auto-sync', source.id)
        return `已${enabled ? '开启' : '关闭'}“${source.name}”的每日自动同步`
      })
    )

  cloud
    .command('update [library]')
    .description('从原 Server 手动更新本地云端副本')
    .action((reference: string | undefined) =>
      runWithRuntime('更新云端副本', async (runtime) => {
        runtime.assertWritable()
        const source = await selectCloudSource(
          runtime.database.listSources(),
          reference,
          runtime.database,
          'cloud-update'
        )
        const spinner = createSpinner()
        spinner.start(`正在更新“${source.name}”`)
        try {
          const result = await runtime.cloud.updateLibrary(
            source.id,
            runtime.database.getSettings().serverUrl
          )
          saveRecentResource(runtime.database, 'cloud-update', source.id)
          spinner.stop(result.updated ? `已更新 ${result.documents} 篇文档` : '已经是最新版本')
          return result.updated ? `云端副本“${source.name}”更新成功` : `“${source.name}”无需更新`
        } catch (error) {
          spinner.error('更新失败')
          throw error
        }
      })
    )

  cloud
    .command('remove [library]')
    .description('删除本地云端副本，不影响 Server')
    .option('--yes', '跳过确认')
    .action((reference: string | undefined, options: { yes?: boolean }) =>
      runWithRuntime('删除云端副本', async (runtime) => {
        runtime.assertWritable()
        const source = await selectCloudSource(runtime.database.listSources(), reference)
        if (!options.yes && !(await askConfirm(`确定删除本地副本“${source.name}”吗？`))) {
          throw new CliCanceledError()
        }
        runtime.deleteSource(source.id)
        return `已删除本地云端副本“${source.name}”，Server 内容未受影响`
      })
    )
}

function parseAutoSyncState(value: string): boolean {
  if (['on', 'true', '1'].includes(value)) return true
  if (['off', 'false', '0'].includes(value)) return false
  throw new CliError('自动同步状态只能是 on 或 off', 2)
}

async function selectCatalog(
  items: CloudCatalogItem[],
  reference: string | undefined,
  database: LociDatabase
): Promise<CloudCatalogItem> {
  if (items.length === 0) throw new CliError('Server 尚未发布文档库')
  if (reference) {
    const matches = items.filter(
      (item) => item.id === reference || item.id.startsWith(reference) || item.name === reference
    )
    if (matches.length === 1) return matches[0]!
    if (matches.length === 0) throw new CliError(`找不到云端文档库：${reference}`, 2)
  }
  if (items.length === 1) return items[0]!
  const remembered = readRecentResource(database, 'cloud-pull')
  const initialValue = items.some((item) => item.id === remembered) ? remembered : undefined
  const id = await askSelect(
    '请选择云端文档库',
    items.map((item) => ({
      value: item.id,
      label: `${item.name}（${item.pages} 页）`,
      hint: item.localSourceId ? (item.updateAvailable ? '有可用更新' : '已下载') : '未下载'
    })),
    initialValue
  )
  return items.find((item) => item.id === id)!
}

async function selectCloudSource(
  sources: DocumentSource[],
  reference: string | undefined,
  database?: LociDatabase,
  preferenceKey?: string
): Promise<DocumentSource> {
  const cloudSources = sources.filter((source) => source.cloud !== null)
  if (cloudSources.length === 0) throw new CliError('还没有下载云端文档库')
  if (reference) {
    const matches = cloudSources.filter(
      (source) =>
        source.id === reference || source.id.startsWith(reference) || source.name === reference
    )
    if (matches.length === 1) return matches[0]!
    if (matches.length === 0) throw new CliError(`找不到云端副本：${reference}`, 2)
  }
  if (cloudSources.length === 1) return cloudSources[0]!
  const remembered =
    database && preferenceKey ? readRecentResource(database, preferenceKey) : undefined
  const initialValue = cloudSources.some((source) => source.id === remembered)
    ? remembered
    : undefined
  const id = await askSelect(
    '请选择本地云端副本',
    cloudSources.map((source) => ({
      value: source.id,
      label: source.name,
      hint: `${source.pages} 页`
    })),
    initialValue
  )
  return cloudSources.find((source) => source.id === id)!
}

function printCatalog(items: CloudCatalogItem[]): void {
  printTable(
    ['名称', '页面', '内容大小', '本地状态', '短 ID'],
    items.map((item) => [
      item.name,
      item.pages,
      formatBytes(item.contentSize),
      !item.localSourceId ? '未下载' : item.updateAvailable ? '有更新' : '最新',
      item.id.slice(0, 8)
    ])
  )
}
