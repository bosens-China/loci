import type { DocumentSource } from '@loci/shared'
import type { BrowserInstallPrompt } from '../browser.js'
import type { CommandResult } from '../command-runtime.js'
import { runLocalSourceSync } from '@loci/runtime'
import { CliError } from '../errors.js'
import type { CliRuntime } from '../runtime.js'
import { askConfirm, createSpinner } from '../ui.js'

/** 执行前台同步，并将发现、处理和失败数量分别展示给用户。 */
export async function syncSource(
  runtime: CliRuntime,
  target: DocumentSource
): Promise<string | CommandResult> {
  const spinner = createSpinner()
  spinner.start(`正在同步“${target.name}”`)
  try {
    const progress = await runLocalSourceSync(runtime, target.id, {
      trigger: 'manual',
      onProgress: (current) => {
        spinner.message(
          `已发现 ${current.queued}，已处理 ${current.processed}，成功 ${current.succeeded}，失败 ${current.failed}`
        )
      },
      onBrowserMissing: createBrowserInstallPrompt(spinner, target.name)
    })
    const summary = `同步完成：成功 ${progress.succeeded}，失败 ${progress.failed}${progress.limitReached ? '，已达到页面上限' : ''}`
    spinner.stop(summary)
    return progress.failed > 0
      ? {
          message: `文档源“${target.name}”已同步，但有 ${progress.failed} 个页面失败`,
          tone: 'warning'
        }
      : `文档源“${target.name}”同步成功`
  } catch (error) {
    spinner.error('同步失败')
    throw error
  }
}

function createBrowserInstallPrompt(
  spinner: ReturnType<typeof createSpinner>,
  sourceName: string
): BrowserInstallPrompt | undefined {
  if (!process.stdin.isTTY) return undefined
  return async (install) => {
    spinner.stop('检测到当前环境缺少无头浏览器')
    const confirmed = await askConfirm(
      '抓取当前文档源需要 Chromium headless shell，是否现在安装？',
      true
    )
    if (!confirmed) throw new CliError('已取消安装无头浏览器，本次同步未执行。')
    process.stdout.write('正在安装 Chromium headless shell…\n')
    await install()
    spinner.start(`继续同步“${sourceName}”`)
  }
}
