import { DOCUMENT_SOURCE_LIMITS } from './source-policy.js'

/** 规范化用户填写的路径排除正则；空字符串表示不启用。 */
export function normalizeExcludePathPattern(input?: string | null): string | null {
  const pattern = input?.trim() ?? ''
  if (!pattern) return null
  if (pattern.length > DOCUMENT_SOURCE_LIMITS.excludePathPatternLength.max) {
    throw new Error(
      `排除路径正则不能超过 ${DOCUMENT_SOURCE_LIMITS.excludePathPatternLength.max} 个字符`
    )
  }
  try {
    new RegExp(pattern, 'u')
  } catch {
    throw new Error('排除路径正则格式无效')
  }
  return pattern
}

/** 生成只匹配 URL pathname 的排除函数，避免查询参数影响路径边界。 */
export function createPathExclusionMatcher(
  input?: string | null
): ((url: string) => boolean) | undefined {
  const pattern = normalizeExcludePathPattern(input)
  if (!pattern) return undefined
  const expression = new RegExp(pattern, 'u')
  return (url) => expression.test(new URL(url).pathname)
}

export function isPathExcluded(url: string, input?: string | null): boolean {
  return createPathExclusionMatcher(input)?.(url) ?? false
}
