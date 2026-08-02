import type { ParsedPage } from './crawl.js'

export type SelectedFetchMode = 'http' | 'browser'

export function selectFetchMode(httpPage: ParsedPage, browserPage: ParsedPage): SelectedFetchMode {
  const httpText = comparableText(httpPage.markdown)
  const browserText = comparableText(browserPage.markdown)
  const similarity = tokenSimilarity(httpText, browserText)
  const browserHasTooMuchContent = browserText.length > httpText.length * 1.1
  const titlesMatch = httpPage.title.trim() === browserPage.title.trim()
  const codeBlocksMatch =
    countCodeBlocks(httpPage.markdown) === countCodeBlocks(browserPage.markdown)
  return similarity >= 0.9 && !browserHasTooMuchContent && titlesMatch && codeBlocksMatch
    ? 'http'
    : 'browser'
}

function comparableText(markdown: string): string {
  return markdown.replace(/\s+/g, ' ').trim().toLowerCase()
}

function tokenSimilarity(left: string, right: string): number {
  if (left === right) return 1
  if (!left || !right) return 0
  const leftTokens = new Set(left.split(/\W+/u).filter(Boolean))
  const rightTokens = new Set(right.split(/\W+/u).filter(Boolean))
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length
  return overlap / Math.max(leftTokens.size, rightTokens.size)
}

function countCodeBlocks(markdown: string): number {
  return (markdown.match(/```/g) ?? []).length
}
