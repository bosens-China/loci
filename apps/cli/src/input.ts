import { DOCUMENT_SOURCE_LIMITS } from '@loci/core'

/** 校验面向抓取场景的公开 HTTP(S) URL。 */
export function validatePublicUrl(value: string | undefined): string | undefined {
  try {
    const url = new URL(value?.trim() ?? '')
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? undefined
      : '只支持 HTTP 或 HTTPS URL'
  } catch {
    return '请输入有效的公开页面 URL'
  }
}

export function validateSourceName(value: string | undefined): string | undefined {
  const length = value?.trim().length ?? 0
  if (length < DOCUMENT_SOURCE_LIMITS.nameLength.min) return '请输入文档源名称'
  return length <= DOCUMENT_SOURCE_LIMITS.nameLength.max
    ? undefined
    : `文档源名称不能超过 ${DOCUMENT_SOURCE_LIMITS.nameLength.max} 个字符`
}
