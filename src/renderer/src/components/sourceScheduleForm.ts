import {
  CUSTOM_SCHEDULE,
  DEFAULT_SCHEDULE,
  getSchedulePreset,
  normalizeCronSchedule
} from '@shared/schedule'
import type { CreateSourceInput, DocumentSource, FetchMode } from '../types'

export interface SourceFormValues {
  name: string
  url: string
  mode: FetchMode
  pageLimit: number
  httpConcurrency: number | null
  browserConcurrency: number | null
  scheduleEnabled: boolean
  schedulePreset: string
  scheduleExpression: string
}

export function getSourceFormValues(source?: DocumentSource): SourceFormValues {
  const schedule = source?.schedule ?? DEFAULT_SCHEDULE
  return {
    name: source?.name ?? '',
    url: source?.url ?? '',
    mode: source?.mode ?? 'auto',
    pageLimit: source?.pageLimit ?? 1000,
    httpConcurrency: source?.httpConcurrency ?? null,
    browserConcurrency: source?.browserConcurrency ?? null,
    scheduleEnabled: Boolean(source?.schedule),
    schedulePreset: getSchedulePreset(schedule)?.expression ?? CUSTOM_SCHEDULE,
    scheduleExpression: schedule
  }
}

export function toCreateSourceInput(values: SourceFormValues): CreateSourceInput {
  return {
    name: values.name,
    url: values.url,
    mode: values.mode ?? 'auto',
    pageLimit: values.pageLimit,
    httpConcurrency: values.httpConcurrency ?? null,
    browserConcurrency: values.browserConcurrency ?? null,
    schedule: values.scheduleEnabled ? normalizeCronSchedule(values.scheduleExpression) : null
  }
}
