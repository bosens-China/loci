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
