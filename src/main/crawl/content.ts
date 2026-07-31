import { parse } from 'node-html-parser'
import { htmlToMarkdown } from 'mdream'
import { normalizeUrl } from './url'

export interface ParsedPage {
  title: string
  language: string
  markdown: string
  links: string[]
}

export function parsePage(html: string, pageUrl: string): ParsedPage {
  const root = parse(html)
  const title = root.querySelector('title')?.text.trim() || new URL(pageUrl).hostname
  const language = root.querySelector('html')?.getAttribute('lang')?.trim() || 'und'
  const links = root
    .querySelectorAll('a')
    .map((link) => link.getAttribute('href'))
    .filter((href): href is string => Boolean(href))
    .map((href) => resolveLink(href, pageUrl))
    .filter((url): url is string => Boolean(url))

  root
    .querySelectorAll('script, style, nav, footer, header, aside, noscript')
    .forEach((node) => node.remove())
  const content =
    root.querySelector('main') ??
    root.querySelector('article') ??
    root.querySelector('body') ??
    root
  const markdown = htmlToMarkdown(content.innerHTML).trim()

  return { title, language, markdown, links: [...new Set(links)] }
}

function resolveLink(href: string, baseUrl: string): string | undefined {
  try {
    return normalizeUrl(new URL(href, baseUrl).toString())
  } catch {
    return undefined
  }
}
