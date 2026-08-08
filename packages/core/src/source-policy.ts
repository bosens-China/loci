/** 文档源各入口共享的产品基础值；入口偏好只能覆盖这些值，不能重新定义它们。 */
export const DOCUMENT_SOURCE_DEFAULTS = {
  mode: 'auto',
  pageLimit: 1000,
  scopePath: '/',
  schedule: null,
  httpConcurrency: null,
  browserConcurrency: null,
  githubArchiveLimitMb: null,
  githubMarkdownLimitMb: null
} as const

/** 文档源输入边界同时用于界面提示、协议 Schema 和领域层最终校验。 */
export const DOCUMENT_SOURCE_LIMITS = {
  nameLength: { min: 1, max: 100 },
  pageLimit: { min: 1, max: 10_000 },
  concurrency: { min: 1, max: 32 },
  githubSizeMb: { min: 1, max: 10_240 }
} as const
