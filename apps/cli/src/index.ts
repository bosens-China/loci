#!/usr/bin/env node
import { runCli } from './cli.js'
import { runCrawlWorker } from './crawl-process.js'
import { CliError, errorMessage } from './errors.js'
import { UPDATE_CHECK_ARGUMENT, runBackgroundUpdateCheck } from './update.js'

const args = process.argv.slice(2)
if (args[0] === UPDATE_CHECK_ARGUMENT) await runBackgroundUpdateCheck()
else {
  try {
    if (args[0] === '__crawl') {
      await runCrawlWorker(args.slice(1))
      // 数据库、抓取器与 IPC 握手均已收口，主动结束第三方库可能遗留的句柄。
      process.exit(0)
    }
    await runCli(args)
    // 取消后先完成 runtime.close 并排空两个输出流；Crawlee 的探测句柄可能继续占用事件循环。
    if (Number(process.exitCode) === 130) {
      await Promise.all(
        [process.stdout, process.stderr].map(
          (stream) => new Promise<void>((resolve) => stream.write('', () => resolve()))
        )
      )
      process.exit(130)
    }
  } catch (error) {
    const message = errorMessage(error)
    process.stderr.write(`${message}\n`)
    if (args.includes('--json')) process.stdout.write(`${JSON.stringify({ error: message })}\n`)
    process.exitCode = error instanceof CliError ? error.exitCode : 1
  }
}
