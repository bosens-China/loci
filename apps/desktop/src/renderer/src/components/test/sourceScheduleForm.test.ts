import { describe, expect, it } from 'vitest'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/core/source-policy'
import { getSourceFormValues, toCreateSourceInput } from '../sourceScheduleForm'

describe('sourceScheduleForm', () => {
  it('未配置高级设置时提交推荐抓取方式和全局并发', () => {
    expect(toCreateSourceInput(getSourceFormValues())).toMatchObject({
      mode: DOCUMENT_SOURCE_DEFAULTS.mode,
      pageLimit: DOCUMENT_SOURCE_DEFAULTS.pageLimit,
      scopePath: DOCUMENT_SOURCE_DEFAULTS.scopePath,
      httpConcurrency: null,
      browserConcurrency: null,
      githubArchiveLimitMb: null,
      githubMarkdownLimitMb: null
    })
  })
})
