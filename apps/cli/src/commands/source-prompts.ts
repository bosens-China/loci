import {
  getSourceScopeOptions,
  type CreateSourceInput,
  type DocumentSource,
  type FetchMode,
  type UpdateSourceInput
} from '@loci/shared'
import { CliError } from '../errors.js'
import { askSelect } from '../ui.js'

export function hasSourceUpdates(options: object): boolean {
  return Object.values(options).some((value) => value !== undefined)
}

export async function askMode(message: string, initial: FetchMode): Promise<FetchMode> {
  return askSelect(
    message,
    [
      { value: 'auto', label: '自动判断' },
      { value: 'http', label: 'HTTP' },
      { value: 'browser', label: '浏览器' }
    ],
    initial
  )
}

export async function askScope(url: string, current: string): Promise<string> {
  const options = getSourceScopeOptions(url)
  const initialValue = options.some((option) => option.value === current) ? current : '/'
  return askSelect(
    '收录范围',
    options.map((option) => ({
      value: option.value,
      label: option.label,
      hint: option.value === '/' ? '收录整个站点' : '只收录该路径及其子路径'
    })),
    initialValue
  )
}

export function formatSourceSummary(input: CreateSourceInput): string {
  return [
    `名称：${input.name}`,
    `URL：${input.url}`,
    `抓取方式：${modeLabel(input.mode)}`,
    `页面上限：${input.pageLimit}`,
    `收录范围：${input.scopePath}`,
    `HTTP 并发：${input.httpConcurrency ?? '继承全局设置'}`,
    `浏览器并发：${input.browserConcurrency ?? '继承全局设置'}`
  ].join('\n')
}

export function formatSourceChanges(
  current: DocumentSource,
  input: Omit<UpdateSourceInput, 'schedule'>
): string {
  const changes = [
    current.url === input.url ? null : `URL：${current.url} → ${input.url}`,
    current.name === input.name ? null : `名称：${current.name} → ${input.name}`,
    current.mode === input.mode
      ? null
      : `抓取方式：${modeLabel(current.mode)} → ${modeLabel(input.mode)}`,
    current.pageLimit === input.pageLimit
      ? null
      : `页面上限：${current.pageLimit} → ${input.pageLimit}`,
    current.scopePath === input.scopePath
      ? null
      : `收录范围：${current.scopePath} → ${input.scopePath}`,
    current.httpConcurrency === input.httpConcurrency
      ? null
      : `HTTP 并发：${current.httpConcurrency ?? '继承全局'} → ${input.httpConcurrency ?? '继承全局'}`,
    current.browserConcurrency === input.browserConcurrency
      ? null
      : `浏览器并发：${current.browserConcurrency ?? '继承全局'} → ${input.browserConcurrency ?? '继承全局'}`
  ].filter((change): change is string => Boolean(change))
  return changes.join('\n')
}

export function sameSourceInput(
  current: DocumentSource,
  input: Omit<UpdateSourceInput, 'schedule'>
): boolean {
  return (
    current.name === input.name &&
    current.url === input.url &&
    current.mode === input.mode &&
    current.pageLimit === input.pageLimit &&
    current.scopePath === input.scopePath &&
    current.httpConcurrency === input.httpConcurrency &&
    current.browserConcurrency === input.browserConcurrency
  )
}

export function numberValue(value: string): number {
  const number = Number(value)
  if (!Number.isInteger(number)) throw new CliError(`无效整数：${value}`, 2)
  return number
}

export function modeLabel(mode: FetchMode): string {
  return { auto: '自动', http: 'HTTP', browser: '浏览器' }[mode]
}
