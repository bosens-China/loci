import { embeddingModelId } from '@loci/runtime'
import { formatBytes, type EmbeddingModelStatus } from '@loci/shared'
import type { Command } from 'commander'
import {
  jsonOption,
  output,
  withCancellation,
  withRuntime,
  type OutputOptions
} from '../command-runtime.js'

function describe(status: EmbeddingModelStatus): string {
  const state =
    status.operation?.error ??
    (
      {
        downloading: '正在下载',
        indexing: '正在建索引',
        failed: '失败',
        cancelled: '已取消'
      } as const
    )[status.operation?.phase ?? 'failed']
  const label = !status.supported
    ? '此平台不支持'
    : status.operation
      ? state
      : !status.installed
        ? '未安装'
        : status.indexed === status.total
          ? '可用'
          : '待更新索引'
  const progress =
    status.operation?.phase === 'downloading'
      ? `${formatBytes(status.operation.downloadedBytes ?? 0)}/${formatBytes(status.downloadBytes)}`
      : `${status.indexed}/${status.total} 篇`
  return `${status.id}\t${status.name}\t${formatBytes(status.downloadBytes)}\t${label}\t${progress}`
}

export function registerModelCommands(program: Command): void {
  const models = program.command('model').description('管理可选的本机向量检索模型')
  jsonOption(models.command('list').description('查看模型、下载大小和索引进度')).action(
    async (opts: OutputOptions) =>
      output(opts, await withRuntime((r) => r.embeddings.list()), (items) =>
        items.map(describe).join('\n')
      )
  )
  jsonOption(models.command('install <model>').description('安装模型并建立或更新本机索引')).action(
    async (value: string, opts: OutputOptions) => {
      const id = embeddingModelId(value)
      const status = await withCancellation((signal) =>
        withRuntime(async ({ embeddings }) => {
          embeddings.start(id)
          let previous = ''
          const timer = setInterval(() => {
            const status = embeddings.getStatus(id)
            const line = describe(status)
            if (line === previous) return
            previous = line
            process.stderr.write(line + '\n')
          }, 1000)
          timer.unref()
          try {
            return await embeddings.wait(id, signal)
          } finally {
            clearInterval(timer)
          }
        })
      )
      if (status.operation?.phase === 'failed') throw new Error(status.operation.error)
      if (status.operation?.phase === 'cancelled') process.exitCode = 130
      output(opts, status, describe)
    }
  )
  jsonOption(models.command('cancel <model>').description('取消正在进行的下载或建索引')).action(
    async (value: string, opts: OutputOptions) =>
      output(opts, await withRuntime((r) => r.embeddings.cancel(embeddingModelId(value))), describe)
  )
}
