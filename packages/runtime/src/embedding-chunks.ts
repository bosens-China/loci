import { listMarkdownSections } from './document-content-utils.js'

export interface EmbeddingChunkLocation {
  startOffset: number
  endOffset: number
  sectionIds: string[]
  headingPath: string[]
}

export interface EmbeddingChunk {
  text: string
  location: EmbeddingChunkLocation
}

/** 片段按原文的 UTF-16 偏移定位，只有向量输入附加标题上下文。 */
export function* splitEmbeddingMarkdown(
  document: { id: string; title: string; markdown: string },
  maxTokens: number,
  countTokens: (text: string) => number
): Generator<EmbeddingChunk> {
  const { id, title, markdown } = document
  const stack: { level: number; title: string }[] = []
  const sections = listMarkdownSections(markdown, title, id).map((section) => {
    if (section.level) {
      while (stack.length && stack.at(-1)!.level >= section.level) stack.pop()
      stack.push(section)
    }
    return { ...section, headingPath: stack.map((heading) => heading.title) }
  })
  const sectionAt = (offset: number) => {
    let first = 0
    let last = sections.length
    while (first + 1 < last) {
      const middle = Math.floor((first + last) / 2)
      if (sections[middle].startOffset <= offset) first = middle
      else last = middle
    }
    return first
  }
  const locate = (startOffset: number, endOffset: number): EmbeddingChunkLocation => {
    const first = sectionAt(startOffset)
    const last = sectionAt(Math.max(startOffset, endOffset - 1))
    return {
      startOffset,
      endOffset,
      sectionIds: sections.slice(first, last + 1).map((section) => section.id),
      headingPath: sections[first].headingPath
    }
  }

  // 整篇优先按字符数判断，实际分词仍要给特殊标记和多 token 字符留出空间。
  if (markdown.length <= maxTokens) {
    const whole = markdown.trim() ? markdown : title
    if (countTokens(whole) <= maxTokens) {
      yield { text: whole, location: locate(0, markdown.length) }
      return
    }
  }

  const prefixAt = (start: number) => {
    const headings = [title, ...sections[sectionAt(start)].headingPath]
    const prefix = [...new Set(headings)].join(' > ').slice(0, Math.min(160, maxTokens / 4))
    return prefix && countTokens(prefix + '\n\n') < maxTokens / 2 ? prefix + '\n\n' : ''
  }

  function* splitRange(start: number, end: number, minLevel: number): Generator<EmbeddingChunk> {
    const prefix = prefixAt(start)
    const fits = (from: number, to: number) =>
      to - from <= maxTokens && countTokens(prefix + markdown.slice(from, to)) <= maxTokens
    const chunk = (from: number, to: number) => ({
      text: prefix + markdown.slice(from, to),
      location: locate(from, to)
    })
    if (fits(start, end)) {
      yield chunk(start, end)
      return
    }

    const sectionStarts = sections.slice(sectionAt(start) + 1, sectionAt(end - 1) + 1)
    for (let level = minLevel; level <= 6; level++) {
      const cuts = sectionStarts.filter((section) => section.level === level)
      if (!cuts.length) continue
      let from = start
      for (const { startOffset } of cuts) {
        yield* splitRange(from, startOffset, level + 1)
        from = startOffset
      }
      yield* splitRange(from, end, level + 1)
      return
    }

    const preferred = paragraphEnds(markdown, start, end)
    let next = 0
    for (let from = start; from < end;) {
      const cap = Math.min(from + maxTokens, end)
      let to = safeCharacterEnd(markdown, cap)
      if (!fits(from, to)) {
        let low = from
        let high = to
        while (low + 1 < high) {
          const middle = Math.floor((low + high) / 2)
          if (fits(from, safeCharacterEnd(markdown, middle))) low = middle
          else high = middle
        }
        to = safeCharacterEnd(markdown, low)
      }
      if (to <= from) throw new Error('模型无法容纳当前文档片段')
      if (to < end) {
        let paragraph = from
        while (next < preferred.length && preferred[next] <= to) paragraph = preferred[next++]
        const boundary = paragraph > from ? paragraph : sentenceOrLineEnd(markdown, from, to)
        if (boundary !== undefined && fits(from, boundary)) to = boundary
      }
      yield chunk(from, to)
      from = to
    }
  }

  yield* splitRange(0, markdown.length, 2)
}

function safeCharacterEnd(text: string, end: number): number {
  // JS 偏移使用 UTF-16，切分时保留完整的 emoji 等代理对。
  const code = text.charCodeAt(end)
  return code >= 0xdc00 && code <= 0xdfff ? end - 1 : end
}

function paragraphEnds(markdown: string, start: number, end: number): number[] {
  const boundaries: number[] = []
  let fence = ''
  for (const line of markdown.slice(start, end).matchAll(/[^\n]*\n|[^\n]+$/gu)) {
    const marker = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)/u.exec(line[0])
    if (marker && (!fence || (marker[1].startsWith(fence) && !marker[2].trim()))) {
      fence = fence ? '' : marker[1]
    }
    if (!fence && !line[0].trim()) boundaries.push(start + line.index + line[0].length)
  }
  return boundaries
}

function sentenceOrLineEnd(markdown: string, start: number, end: number): number | undefined {
  const text = markdown.slice(start, end)
  let sentence: number | undefined
  for (const match of text.matchAll(/[。！？]+|[.!?]+(?=\s)/gu)) {
    sentence = start + match.index + match[0].length
  }
  if (sentence !== undefined) return sentence
  const newline = text.lastIndexOf('\n')
  return newline === -1 ? undefined : start + newline + 1
}
