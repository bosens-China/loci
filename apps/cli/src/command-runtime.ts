import type { CliRuntime } from './runtime.js'
import { createCliRuntime } from './runtime.js'
import { finishUi, startUi } from './ui.js'

export interface CommandResult {
  message: string
  tone: 'success' | 'warning'
}

export async function runWithRuntime(
  title: string,
  action: (runtime: CliRuntime) => Promise<string | CommandResult | void>
): Promise<void> {
  startUi(title)
  const runtime = createCliRuntime()
  try {
    const message = await action(runtime)
    if (typeof message === 'object') {
      finishUi(message.message, message.tone)
      if (message.tone === 'warning') process.exitCode = 3
    } else finishUi(message ?? '操作完成')
  } finally {
    await runtime.close()
  }
}
