import {
  CUSTOM_SCHEDULE,
  DEFAULT_SCHEDULE,
  getSchedulePreset,
  normalizeCronSchedule
} from '@loci/shared'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/core/source-policy'
import type { CreateSourceInput, DocumentSource, FetchMode } from '../types'

export interface SourceFormValues {
  name: string
  url: string
  mode: FetchMode
  pageLimit: number
  scopePath: string
  httpConcurrency: number | null
  browserConcurrency: number | null
  githubArchiveLimitMb: number | null
  githubMarkdownLimitMb: number | null
  scheduleEnabled: boolean
  schedulePreset: string
  scheduleExpression: string
}

export function getSourceFormValues(source?: DocumentSource): SourceFormValues {
  const schedule = source?.schedule ?? DEFAULT_SCHEDULE
  return {
    name: source?.name ?? '',
    url: source?.url ?? '',
    mode: source?.mode ?? DOCUMENT_SOURCE_DEFAULTS.mode,
    pageLimit: source?.pageLimit ?? DOCUMENT_SOURCE_DEFAULTS.pageLimit,
    scopePath: source?.scopePath ?? DOCUMENT_SOURCE_DEFAULTS.scopePath,
    httpConcurrency: source?.httpConcurrency ?? DOCUMENT_SOURCE_DEFAULTS.httpConcurrency,
    browserConcurrency: source?.browserConcurrency ?? DOCUMENT_SOURCE_DEFAULTS.browserConcurrency,
    githubArchiveLimitMb:
      source?.githubArchiveLimitMb ?? DOCUMENT_SOURCE_DEFAULTS.githubArchiveLimitMb,
    githubMarkdownLimitMb:
      source?.githubMarkdownLimitMb ?? DOCUMENT_SOURCE_DEFAULTS.githubMarkdownLimitMb,
    scheduleEnabled: Boolean(source?.schedule),
    schedulePreset: getSchedulePreset(schedule)?.expression ?? CUSTOM_SCHEDULE,
    scheduleExpression: schedule
  }
}

export function toCreateSourceInput(values: SourceFormValues): CreateSourceInput {
  return {
    name: values.name,
    url: values.url,
    mode: values.mode ?? DOCUMENT_SOURCE_DEFAULTS.mode,
    pageLimit: values.pageLimit,
    scopePath: values.scopePath,
    httpConcurrency: values.httpConcurrency ?? null,
    browserConcurrency: values.browserConcurrency ?? null,
    githubArchiveLimitMb: values.githubArchiveLimitMb ?? null,
    githubMarkdownLimitMb: values.githubMarkdownLimitMb ?? null,
    schedule: values.scheduleEnabled ? normalizeCronSchedule(values.scheduleExpression) : null
  }
}
