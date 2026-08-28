import {
  DOCUMENT_SOURCE_DEFAULTS,
  deriveSourceName,
  getDocumentContentRemovalRisk,
  getSourceScopeOptions,
  getUpcomingScheduleRuns,
  parseGithubRepositoryUrl,
  type DocumentSource,
  type FetchMode,
  type SourceKind
} from '@loci/shared'

interface StoredLibraryLocation {
  kind: SourceKind
  url: string
  scopePath: string
  excludePathPattern?: string | null
}

interface LibraryUrlDefaultsInput {
  url: string
  name: string
  scopePath: string
  nameTouched: boolean
  suggestName: boolean
}

export interface LibraryUrlDefaults {
  name?: string
  scopePath?: string
}

/** 浏览器状态未知时保留产品默认值，明确未安装时使用 HTTP。 */
export function getNewSourceFetchMode(browserInstalled?: boolean): FetchMode {
  return browserInstalled === false ? 'http' : DOCUMENT_SOURCE_DEFAULTS.mode
}

/** 根据 URL 补齐安全默认值，不覆盖用户主动输入的名称。 */
export function getLibraryUrlDefaults(input: LibraryUrlDefaultsInput): LibraryUrlDefaults {
  const options = getSourceScopeOptions(input.url)
  if (!options.length) return {}

  const defaults: LibraryUrlDefaults = {}
  if (!options.some((option) => option.value === input.scopePath)) {
    defaults.scopePath = DOCUMENT_SOURCE_DEFAULTS.scopePath
  }
  if (input.suggestName && (!input.name.trim() || !input.nameTouched)) {
    const name = parseGithubRepositoryUrl(input.url)?.repo ?? deriveSourceName(input.url)
    if (name) defaults.name = name
  }
  return defaults
}

export function getLibrarySchedulePreview(value: string | null | undefined): Date[] {
  try {
    return getUpcomingScheduleRuns(value, 2)
  } catch {
    return []
  }
}

export function validateLibrarySourceKind(kind: SourceKind, url: string): string | null {
  const repository = parseGithubRepositoryUrl(url)
  if (kind === 'github' && !repository) return '请输入公开 GitHub 仓库首页 URL'
  if (kind === 'web' && repository) return 'GitHub 仓库请切换到“GitHub 仓库”来源'
  return null
}

/** 返回保存前需要展示的正文删除风险；扩大范围或清空排除规则不会触发误导性警告。 */
export function getLocalLibraryRemovalWarning(
  current: StoredLibraryLocation,
  next: StoredLibraryLocation
): string | null {
  const risk = getDocumentContentRemovalRisk(current, next)
  if (risk === 'source_changed') {
    return '文档来源切换会立即删除现有正文和搜索索引。保存后需要重新同步。'
  }
  return risk ? '收窄收录范围或新增、修改排除规则会立即删除不再匹配的正文和搜索索引。' : null
}

/** 检测来源对象或表单值中是否包含非默认的高级配置项。 */
export function getAdvancedSettingsSummary(source?: Partial<DocumentSource> | null): number {
  if (!source) return 0
  let customCount = 0

  if (source.pageLimit != null && source.pageLimit !== DOCUMENT_SOURCE_DEFAULTS.pageLimit) {
    customCount++
  }
  if (source.schedule && source.schedule.trim()) {
    customCount++
  }
  if (source.kind === 'github') {
    if (source.githubArchiveLimitMb != null) customCount++
    if (source.githubMarkdownLimitMb != null) customCount++
  } else {
    if (source.mode && source.mode !== DOCUMENT_SOURCE_DEFAULTS.mode) {
      customCount++
    }
    if (source.excludePathPattern && source.excludePathPattern.trim()) {
      customCount++
    }
    if (source.httpConcurrency != null) customCount++
    if (source.browserConcurrency != null) customCount++
  }

  return customCount
}
