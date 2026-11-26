import { confirm, isCancel, select } from '@clack/prompts'
import { CliCanceledError, CliError } from './errors.js'

/** 即使 stdout 被重定向，交互提示也只写到 stderr。 */
export async function confirmWrite(
  message: string | (() => string | Promise<string>),
  yes?: boolean
): Promise<void> {
  if (yes) return
  if (!process.stdin.isTTY) throw new CliError('非交互终端请传入 --yes 跳过确认', 2)
  const reply = await confirm({
    message: typeof message === 'string' ? message : await message(),
    initialValue: false,
    output: process.stderr
  })
  if (isCancel(reply) || !reply) throw new CliCanceledError()
}

export async function selectClient<T extends string>(
  options: { value: T; label: string }[]
): Promise<T> {
  if (!process.stdin.isTTY) throw new CliError('请指定 Agent 客户端', 2)
  const selected = await select<string>({
    message: '请选择 Agent 客户端',
    options,
    output: process.stderr
  })
  if (isCancel(selected)) throw new CliCanceledError()
  return selected as T
}
