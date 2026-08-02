import { describe, expect, it } from 'vitest'
import { getSourceFormValues, toCreateSourceInput } from './sourceScheduleForm'

describe('sourceScheduleForm', () => {
  it('未配置高级设置时提交推荐抓取方式和全局并发', () => {
    expect(toCreateSourceInput(getSourceFormValues())).toMatchObject({
      mode: 'auto',
      httpConcurrency: null,
      browserConcurrency: null
    })
  })
})
