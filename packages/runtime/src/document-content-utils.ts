import type { DocumentSectionSummary, EditDocumentSectionInput, SearchPassage } from '@loci/shared'
import { toSearchTokens } from './database-values.js'

export type { SearchPassage } from '@loci/shared'

interface MarkdownSection {
  level: number
  startOffset: number
  endOffset: number
  bodyOffset: number
  title: string
  content: string
  paragraphs: string[]
}

export interface ContentSlice {
  content: string
  offset: number
  nextOffset?: number
  totalChars: number
  truncated: boolean
}

const PASSAGE_LIMIT = 1600

export function findBestPassage(
  markdown: string,
  query: string,
  fallbackTitle: string,
  fileId: string,
  allowedSections?: ReadonlySet<string>
): SearchPassage {
  const tokens = toSearchTokens(query).map((token) => token.toLocaleLowerCase())
  const passages = splitSections(markdown, fallbackTitle).flatMap((section, sectionIndex) => {
    const sectionId = createSectionId(fileId, sectionIndex)
    if (allowedSections && !allowedSections.has(sectionId)) return []
    return (section.paragraphs.length ? section.paragraphs : ['']).map((paragraph) => ({
      sectionId,
      sectionTitle: section.title,
      paragraph,
      truncated: false
    }))
  })
  const best = passages.reduce(
    (current, passage) => {
      const text = `${passage.sectionTitle}\n${passage.paragraph}`.toLocaleLowerCase()
      const score = tokens.reduce((total, token) => total + Number(text.includes(token)), 0)
      return score > current.score ? { passage, score } : current
    },
    {
      passage: passages[0] ?? {
        sectionId: createSectionId(fileId, 0),
        sectionTitle: fallbackTitle,
        paragraph: '',
        truncated: false
      },
      score: -1
    }
  ).passage
  return {
    sectionId: best.sectionId,
    sectionTitle: best.sectionTitle,
    paragraph: best.paragraph.slice(0, PASSAGE_LIMIT),
    truncated: best.paragraph.length > PASSAGE_LIMIT
  }
}

export function readMarkdownSection(
  markdown: string,
  sectionId: string,
  fileId: string,
  fallbackTitle: string
): { title: string; content: string; headingPath: string[] } | undefined {
  const prefix = `${fileId}:section:`
  if (!sectionId.startsWith(prefix)) return undefined
  const suffix = sectionId.slice(prefix.length)
  if (!/^\d+$/u.test(suffix)) return undefined
  const index = Number(suffix)
  if (!Number.isSafeInteger(index) || index < 0) return undefined
  const sections = splitSections(markdown, fallbackTitle)
  const section = sections[index]
  if (!section) return undefined
  const headingPath = section.level ? [section.title] : []
  let level = section.level
  for (let cursor = index - 1; cursor >= 0 && level > 1; cursor--) {
    const parent = sections[cursor]
    if (parent.level && parent.level < level) {
      headingPath.unshift(parent.title)
      level = parent.level
    }
  }
  return { title: section.title, content: section.content, headingPath }
}

// 尽量在段落边界截断，避免续读时把 Markdown 结构从中间切开。
export function sliceContent(content: string, offset: number, limit: number): ContentSlice {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit <= 0)
    throw new Error('切片偏移或长度无效')
  const safeOffset = Math.min(offset, content.length)
  const targetEnd = Math.min(safeOffset + limit, content.length)
  let end = targetEnd
  if (targetEnd < content.length) {
    const boundary = content.lastIndexOf('\n\n', targetEnd - 2)
    if (boundary >= safeOffset + Math.floor(limit * 0.6)) end = boundary + 2
  }
  return {
    content: content.slice(safeOffset, end),
    offset: safeOffset,
    ...(end < content.length ? { nextOffset: end } : {}),
    totalChars: content.length,
    truncated: end < content.length
  }
}

function createSectionId(fileId: string, index: number): string {
  return `${fileId}:section:${index}`
}

function splitSections(markdown: string, fallbackTitle: string): MarkdownSection[] {
  const sections: MarkdownSection[] = []
  let title = fallbackTitle
  let heading = ''
  let startOffset = 0
  let bodyOffset = 0
  let level = 0
  const flush = (endOffset: number): void => {
    const body = markdown.slice(bodyOffset, endOffset).replaceAll('\r\n', '\n').trim()
    if (body || heading) {
      sections.push({
        title,
        level,
        startOffset,
        endOffset,
        bodyOffset,
        content: [heading, body].filter(Boolean).join('\n\n'),
        paragraphs: body
          .split(/\n\s*\n/u)
          .map((item) => item.trim())
          .filter(Boolean)
      })
    }
  }

  let fence = ''
  for (const matchLine of markdown.matchAll(/[^\n]*\n|[^\n]+$/gu)) {
    const line = matchLine[0].replace(/\r?\n$/u, '')
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
    if (marker && (!fence || (marker[1].startsWith(fence) && !marker[2].trim()))) {
      fence = fence ? '' : marker[1]
      continue
    }
    const match = !fence && /^(#{1,6})\s+(.+?)\s*$/u.exec(line)
    if (match) {
      flush(matchLine.index)
      startOffset = matchLine.index
      bodyOffset = startOffset + matchLine[0].length
      title = match[2]
      level = match[1].length
      heading = line
    }
  }
  flush(markdown.length)
  return sections.length
    ? sections
    : [
        {
          title: fallbackTitle,
          level: 0,
          startOffset: 0,
          bodyOffset: 0,
          endOffset: markdown.length,
          content: '',
          paragraphs: []
        }
      ]
}

/** 偏移针对未归一化的原始 Markdown，以 UTF-16 码元计数。 */
export function listMarkdownSections(
  markdown: string,
  title: string,
  fileId: string
): DocumentSectionSummary[] {
  return splitSections(markdown, title).map(
    ({ title, level, startOffset, bodyOffset, endOffset }, index) => ({
      body: markdown.slice(bodyOffset, endOffset),
      id: createSectionId(fileId, index),
      title,
      level,
      startOffset,
      endOffset,
      charCount: endOffset - startOffset
    })
  )
}

export function editMarkdownSection(
  markdown: string,
  title: string,
  fileId: string,
  input: EditDocumentSectionInput
): string {
  const sections = splitSections(markdown, title)
  const section = sections.find((_, index) => createSectionId(fileId, index) === input.sectionId)
  if (!section && (input.action !== 'add' || input.sectionId !== undefined))
    throw new Error('小节不存在或与文档不匹配')
  if (section && input.action === 'delete')
    return markdown.slice(0, section.startOffset) + markdown.slice(section.endOffset)
  if (input.action !== 'add' && input.action !== 'update') throw new Error('小节操作无效')
  const adding = input.action === 'add'
  const heading = input.heading?.trim() ?? (adding ? '' : section!.title)
  if ((adding || input.heading !== undefined) && (!heading || /[\r\n]/u.test(heading)))
    throw new Error('小节标题必须为非空单行文本')
  if (
    input.level !== undefined &&
    (!Number.isInteger(input.level) || input.level < 1 || input.level > 6)
  )
    throw new Error('小节级别必须为 1 到 6')
  const level = input.level ?? (adding ? 2 : section!.level || (input.heading ? 1 : 0))
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n'
  const start = adding ? (section?.endOffset ?? markdown.length) : section!.startOffset
  const end = adding ? start : section!.endOffset
  const prefix = markdown.slice(0, start)
  const suffix = markdown.slice(end)
  const currentBody = adding ? '' : markdown.slice(section!.bodyOffset, end)
  const body = input.content ?? currentBody
  if (!adding && heading === section!.title && level === section!.level && body === currentBody)
    return markdown
  const originalHeader = !adding && section!.level ? markdown.slice(start, section!.bodyOffset) : ''
  const lineEnding = /\r?\n$/u.exec(originalHeader)?.[0] ?? ''
  const header =
    !adding && heading === section!.title && level === section!.level
      ? originalHeader.slice(0, originalHeader.length - lineEnding.length)
      : level
        ? '#'.repeat(level) + ' ' + heading
        : ''
  const replacement = header + (header ? lineEnding || (body ? newline : '') : '') + body
  const gap = (left: string, right: string) =>
    left && right && !left.endsWith('\n') ? newline : ''
  return prefix + gap(prefix, replacement) + replacement + gap(replacement, suffix) + suffix
}
