import {
  getDocumentContentRemovalRisk,
  getSourceScopeOptions,
  type AppSettings,
  type CreateSourceInput,
  type DocumentSource,
  type FetchMode,
  type UpdateSourceInput
} from '@loci/shared'
import { isGithubRepositoryUrl } from '@loci/core'
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

export function formatSourceSummary(
  input: CreateSourceInput,
  settings?: Pick<AppSettings, 'githubArchiveLimitMb' | 'githubMarkdownLimitMb'>
): string {
  if (isGithubRepositoryUrl(input.url)) {
    const archiveLimit = input.githubArchiveLimitMb ?? settings?.githubArchiveLimitMb
    const markdownLimit = input.githubMarkdownLimitMb ?? settings?.githubMarkdownLimitMb
    return [
      `名称：${input.name}`,
      `仓库：${input.url}`,
      `Markdown 上限：${input.pageLimit}`,
      `ZIP 上限：${archiveLimit ? `${archiveLimit} MB` : '继承全局设置'}`,
      `Markdown 总量：${markdownLimit ? `${markdownLimit} MB` : '继承全局设置'}`
    ].join('\n')
  }
  return [
    `名称：${input.name}`,
    `URL：${input.url}`,
    `抓取方式：${modeLabel(input.mode)}`,
    `页面上限：${input.pageLimit}`,
    `收录范围：${input.scopePath}`,
    `排除路径：${input.excludePathPattern || '未启用'}`,
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
    (current.excludePathPattern ?? null) === (input.excludePathPattern ?? null)
      ? null
      : `排除路径：${current.excludePathPattern || '未启用'} → ${input.excludePathPattern || '未启用'}`,
    current.httpConcurrency === input.httpConcurrency
      ? null
      : `HTTP 并发：${current.httpConcurrency ?? '继承全局'} → ${input.httpConcurrency ?? '继承全局'}`,
    current.browserConcurrency === input.browserConcurrency
      ? null
      : `浏览器并发：${current.browserConcurrency ?? '继承全局'} → ${input.browserConcurrency ?? '继承全局'}`,
    current.githubArchiveLimitMb === (input.githubArchiveLimitMb ?? null)
      ? null
      : `ZIP 上限：${current.githubArchiveLimitMb ?? '继承全局'} → ${input.githubArchiveLimitMb ?? '继承全局'} MB`,
    current.githubMarkdownLimitMb === (input.githubMarkdownLimitMb ?? null)
      ? null
      : `Markdown 总量：${current.githubMarkdownLimitMb ?? '继承全局'} → ${input.githubMarkdownLimitMb ?? '继承全局'} MB`
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
    (current.excludePathPattern ?? null) === (input.excludePathPattern ?? null) &&
    current.httpConcurrency === input.httpConcurrency &&
    current.browserConcurrency === input.browserConcurrency &&
    current.githubArchiveLimitMb === (input.githubArchiveLimitMb ?? null) &&
    current.githubMarkdownLimitMb === (input.githubMarkdownLimitMb ?? null)
  )
}

/** 交互保存前说明会立即发生的正文删除，不把扩大范围或清空排除规则误报为删除。 */
export function getSourceRemovalWarning(
  current: DocumentSource,
  input: Omit<UpdateSourceInput, 'schedule'>
): string | null {
  const risk = getDocumentContentRemovalRisk(current, {
    kind: input.kind ?? (isGithubRepositoryUrl(input.url) ? 'github' : 'web'),
    url: input.url,
    scopePath: input.scopePath ?? current.scopePath,
    excludePathPattern: input.excludePathPattern
  })
  if (risk === 'source_changed') {
    return '文档来源已切换，现有正文和搜索索引会立即清空，需要重新同步'
  }
  return risk ? '收窄范围或新增、修改排除规则会立即删除不再匹配的正文和搜索索引' : null
}

export function numberValue(value: string): number {
  const number = Number(value)
  if (!Number.isInteger(number)) throw new CliError(`无效整数：${value}`, 2)
  return number
}

export function modeLabel(mode: FetchMode): string {
  return { auto: '自动', http: 'HTTP', browser: '浏览器' }[mode]
}
