export interface SearchPassage {
  sectionId: string
  sectionTitle: string
  paragraph: string
  truncated: boolean
}

interface MarkdownSection {
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
  fileId: string
): SearchPassage {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean)
  const passages = splitSections(markdown, fallbackTitle).flatMap((section, sectionIndex) =>
    section.paragraphs.map((paragraph) => ({
      sectionId: createSectionId(fileId, sectionIndex),
      sectionTitle: section.title,
      paragraph,
      truncated: false
    }))
  )
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
): { title: string; content: string } | undefined {
  const prefix = `${fileId}:section:`
  if (!sectionId.startsWith(prefix)) return undefined
  const index = Number(sectionId.slice(prefix.length))
  if (!Number.isSafeInteger(index) || index < 0) return undefined
  const section = splitSections(markdown, fallbackTitle)[index]
  return section ? { title: section.title, content: section.content } : undefined
}

// 尽量在段落边界截断，避免续读时把 Markdown 结构从中间切开。
export function sliceContent(content: string, offset: number, limit: number): ContentSlice {
  const safeOffset = Math.min(offset, content.length)
  const targetEnd = Math.min(safeOffset + limit, content.length)
  let end = targetEnd
  if (targetEnd < content.length) {
    const boundary = content.lastIndexOf('\n\n', targetEnd)
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
  let lines: string[] = []
  const flush = (): void => {
    const body = lines.join('\n').trim()
    if (body || heading) {
      sections.push({
        title,
        content: [heading, body].filter(Boolean).join('\n\n'),
        paragraphs: body
          .split(/\n\s*\n/u)
          .map((item) => item.trim())
          .filter(Boolean)
      })
    }
    lines = []
  }

  for (const line of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const match = /^#{1,6}\s+(.+?)\s*$/u.exec(line)
    if (match) {
      flush()
      title = match[1]
      heading = line
    } else lines.push(line)
  }
  flush()
  return sections
}
