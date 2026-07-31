import { parse } from 'node-html-parser'
import { isSameHostname, normalizeUrl } from './url'

export function parseSitemap(
  xml: string,
  baseUrl: string,
  hostname: string,
  limit: number
): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const node of parse(xml).querySelectorAll('loc')) {
    try {
      const url = normalizeUrl(new URL(node.text.trim(), baseUrl).toString())
      if (isSameHostname(url, hostname) && !seen.has(url)) {
        urls.push(url)
        seen.add(url)
      }
    } catch {
      continue
    }
    if (urls.length >= limit) break
  }
  return urls
}
