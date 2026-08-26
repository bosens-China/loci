import {
  DOCUMENT_SOURCE_DEFAULTS,
  deriveSourceName,
  getSourceScopeOptions,
  getUpcomingScheduleRuns,
  parseGithubRepositoryUrl,
  scopePathContains,
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
  const nextRepository = parseGithubRepositoryUrl(next.url)
  if (
    current.kind !== next.kind ||
    new URL(current.url).hostname !== new URL(next.url).hostname ||
    (next.kind === 'github' && current.url !== nextRepository?.url)
  ) {
    return '文档来源切换会立即删除现有正文和搜索索引。保存后需要重新同步。'
  }
  const scopeMayRemoveDocuments = !scopePathContains(next.scopePath, current.scopePath)
  const nextExclusion = next.excludePathPattern?.trim() || null
  const currentExclusion = current.excludePathPattern?.trim() || null
  const exclusionMayRemoveDocuments = nextExclusion !== null && nextExclusion !== currentExclusion
  if (!scopeMayRemoveDocuments && !exclusionMayRemoveDocuments) return null
  return '收窄收录范围或新增、修改排除规则会立即删除不再匹配的正文和搜索索引。'
}
