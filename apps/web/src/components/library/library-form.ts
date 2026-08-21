import {
  DOCUMENT_SOURCE_DEFAULTS,
  deriveSourceName,
  getSourceScopeOptions,
  getUpcomingScheduleRuns,
  parseGithubRepositoryUrl
} from '@loci/shared'

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
