import * as p from '@clack/prompts'
import { TextPrompt } from '@clack/core'
import { styleText } from 'node:util'
import Table from 'cli-table3'
import { CliCanceledError, CliError } from './errors.js'

interface AskTextOptions {
  initialValue?: string
  placeholder?: string
  required?: boolean
  validate?: (value: string | undefined) => string | Error | undefined
  liveHint?: (value: string) => string | undefined
}

interface AskIntegerOptions {
  initialValue: number
  minimum: number
  maximum: number
}

interface AskPathOptions {
  root?: string
  initialValue?: string
  directory?: boolean
  validate?: (value: string | undefined) => string | Error | undefined
}

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

export async function askText(message: string, options: AskTextOptions = {}): Promise<string> {
  requireInteractive()
  const validate = (value: string | undefined): string | Error | undefined => {
    if (options.required !== false && !value?.trim()) return '请输入内容'
    return options.validate?.(value)
  }
  const result = options.liveHint
    ? await dynamicText(message, options, validate)
    : await p.text({
        message,
        initialValue: options.initialValue,
        placeholder: options.placeholder,
        validate
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

export async function askInteger(message: string, options: AskIntegerOptions): Promise<number> {
  const value = await askText(message, {
    initialValue: String(options.initialValue),
    validate: (input) => {
      const number = Number(input)
      return Number.isInteger(number) && number >= options.minimum && number <= options.maximum
        ? undefined
        : `${message}必须是 ${options.minimum} 到 ${options.maximum} 之间的整数`
    }
  })
  return Number(value)
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

export async function askMultiSelect<T extends string>(
  message: string,
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>,
  initialValues: T[] = []
): Promise<T[]> {
  requireInteractive()
  const normalized: Array<{ value: string; label: string; hint?: string }> = options.map(
    (option) =>
      option.hint
        ? { value: option.value, label: option.label, hint: option.hint }
        : { value: option.value, label: option.label }
  )
  return unwrap(
    await p.multiselect<string>({ message, options: normalized, initialValues, required: true })
  ) as T[]
}

export async function askSearch<T extends string>(
  message: string,
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>,
  placeholder = '输入关键词筛选',
  initialValue?: T
): Promise<T> {
  requireInteractive()
  const normalized: Array<{ value: string; label: string; hint?: string }> = options.map(
    (option) =>
      option.hint
        ? { value: option.value, label: option.label, hint: option.hint }
        : { value: option.value, label: option.label }
  )
  return unwrap(
    await p.autocomplete<string>({ message, options: normalized, placeholder, initialValue })
  ) as T
}

export async function askPath(message: string, options: AskPathOptions = {}): Promise<string> {
  requireInteractive()
  const result = await p.path({
    message,
    root: options.root,
    initialValue: options.initialValue,
    directory: options.directory,
    validate: options.validate
  })
  return unwrap(result)
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

export function note(message: string, title?: string): void {
  p.note(message, title)
}

/** 支持随输入内容变化的底部提示，适合时间表达式等需要即时解释的字段。 */
async function dynamicText(
  message: string,
  options: AskTextOptions,
  validate: (value: string | undefined) => string | Error | undefined
): Promise<string | symbol> {
  const prompt = new TextPrompt({
    initialValue: options.initialValue,
    placeholder: options.placeholder,
    validate,
    render() {
      const withGuide = p.settings.withGuide
      const header = `${p.symbol(this.state)}  ${message}\n`
      const placeholder = options.placeholder
        ? styleText('inverse', options.placeholder[0] ?? '_') +
          styleText('dim', options.placeholder.slice(1))
        : styleText(['inverse', 'hidden'], '_')
      const value = this.userInput ? this.userInputWithCursor : placeholder
      const bar = withGuide ? `${styleText('cyan', p.S_BAR)}  ` : ''
      if (this.state === 'submit') {
        const submitted = this.value ? `  ${styleText('dim', this.value)}` : ''
        return `${header}${withGuide ? styleText('gray', p.S_BAR) : ''}${submitted}`
      }
      if (this.state === 'cancel') {
        const canceled = this.value ? `  ${styleText(['strikethrough', 'dim'], this.value)}` : ''
        return `${header}${withGuide ? styleText('gray', p.S_BAR) : ''}${canceled}`
      }
      if (this.state === 'error') {
        const error = this.error ? `  ${styleText('yellow', this.error)}` : ''
        return `${header.trim()}\n${bar}${value}\n${withGuide ? styleText('yellow', p.S_BAR_END) : ''}${error}\n`
      }
      const hint = options.liveHint?.(this.userInput)
      const footer = hint ? `  ${styleText('dim', hint)}` : ''
      return `${header}${bar}${value}\n${withGuide ? styleText('cyan', p.S_BAR_END) : ''}${footer}\n`
    }
  })
  return (await prompt.prompt()) ?? ''
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
