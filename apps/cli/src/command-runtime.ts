import { setTimeout as delay } from 'node:timers/promises'
import { RuntimeLockedError } from '@loci/runtime'
import { InvalidArgumentError, type Command } from 'commander'
import { createCliRuntime, type CliRuntime } from './runtime.js'

export interface OutputOptions {
  json?: boolean
}

/** 每条命令只有一个结果输出点，运行时及信号订阅随命令结束释放。 */
export async function withRuntime<T>(
  action: (runtime: CliRuntime) => T | Promise<T>,
  detachedCrawl = false
): Promise<T> {
  let runtime: CliRuntime
  const deadline = Date.now() + 5000
  while (true) {
    try {
      runtime = createCliRuntime(detachedCrawl)
      break
    } catch (error) {
      // 并发首次打开或恢复 WAL 时可安全重试初始化，业务操作仅执行一次。
      const migrating =
        error instanceof RuntimeLockedError && error.record?.owner.endsWith('数据库迁移')
      const busy = error instanceof Error && 'errcode' in error && error.errcode === 5
      if ((!migrating && !busy) || Date.now() >= deadline) throw error
      await delay(25)
    }
  }
  try {
    return await action(runtime)
  } finally {
    await runtime.close()
  }
}

export function output<T>(options: OutputOptions, value: T, text?: (value: T) => string): void {
  const body = options.json
    ? JSON.stringify(value)
    : text
      ? text(value)
      : JSON.stringify(value, null, 2)
  process.stdout.write(`${body}\n`)
}

export function jsonOption(command: Command): Command {
  return command.option('--json', '只向 stdout 输出 JSON')
}

export function natural(value: string): number {
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value)))
    throw new InvalidArgumentError('请输入非负整数')
  return Number(value)
}

export function positive(value: string): number {
  const number = natural(value)
  if (!number) throw new InvalidArgumentError('请输入正整数')
  return number
}

export async function withCancellation<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const cancel = () => controller.abort(new Error('操作已取消'))
  process.on('SIGINT', cancel)
  process.on('SIGTERM', cancel)
  try {
    return await action(controller.signal)
  } finally {
    process.off('SIGINT', cancel)
    process.off('SIGTERM', cancel)
  }
}
