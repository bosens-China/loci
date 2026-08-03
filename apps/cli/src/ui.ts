import * as p from '@clack/prompts'
import Table from 'cli-table3'
import { CliCanceledError, CliError } from './errors.js'

export function startUi(title = 'Loci CLI'): void {
  if (process.stdout.isTTY) p.intro(title)
}

export function finishUi(message: string, tone: 'success' | 'warning' = 'success'): void {
  const prefix = tone === 'success' ? '✓' : '⚠'
  if (process.stdout.isTTY) p.outro(`${prefix} ${message}`)
  else process.stdout.write(`${tone === 'success' ? '成功' : '警告'}：${message}\n`)
}

export function success(message: string): void {
  p.log.success(message)
}

export function info(message: string): void {
  p.log.info(message)
}

export function warning(message: string): void {
  p.log.warn(message)
}

export function failure(message: string): void {
  p.log.error(message)
}

export async function askText(
  message: string,
  options: { initialValue?: string; placeholder?: string; required?: boolean } = {}
): Promise<string> {
  requireInteractive()
  const result = await p.text({
    message,
    initialValue: options.initialValue,
    placeholder: options.placeholder,
    validate:
      options.required === false
        ? undefined
        : (value) => (!value?.trim() ? '请输入内容' : undefined)
  })
  return unwrap(result).trim()
}

export async function askPassword(message: string): Promise<string> {
  requireInteractive()
  const result = await p.password({
    message,
    validate: (value) => (!value?.length ? '请输入密码' : undefined)
  })
  return unwrap(result)
}

export async function askConfirm(message: string, initialValue = false): Promise<boolean> {
  requireInteractive()
  return unwrap(await p.confirm({ message, initialValue }))
}

export async function askSelect<T extends string>(
  message: string,
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>,
  initialValue?: T
): Promise<T> {
  requireInteractive()
  const normalized: Array<{ value: string; label: string; hint?: string }> = options.map(
    (option) =>
      option.hint
        ? { value: option.value, label: option.label, hint: option.hint }
        : { value: option.value, label: option.label }
  )
  return unwrap(await p.select<string>({ message, options: normalized, initialValue })) as T
}

export function createSpinner(): ReturnType<typeof p.spinner> {
  return p.spinner()
}

export function printTable(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[]
): void {
  const table = new Table({
    head: [...headers],
    style: { head: [], border: [] },
    wordWrap: true
  })
  table.push(...rows.map((row) => row.map((value) => String(value ?? '—'))))
  process.stdout.write(`${table.toString()}\n`)
}

export function printList(lines: readonly string[]): void {
  process.stdout.write(lines.map((line) => `• ${line}`).join('\n') + '\n')
}

function unwrap<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('操作已取消')
    throw new CliCanceledError()
  }
  return value as T
}

function requireInteractive(): void {
  if (!process.stdin.isTTY) throw new CliError('当前终端不可交互，请通过命令选项提供所需参数', 2)
}
