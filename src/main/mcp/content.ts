export interface SearchPassage {
  sectionTitle: string
  paragraph: string
  truncated: boolean
}

const PASSAGE_LIMIT = 1600

export function findBestPassage(
  markdown: string,
  query: string,
  fallbackTitle: string
): SearchPassage {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean)
  const passages = splitPassages(markdown, fallbackTitle)
  const best = passages.reduce(
    (current, passage) => {
      const text = `${passage.sectionTitle}\n${passage.paragraph}`.toLocaleLowerCase()
      const score = tokens.reduce((total, token) => total + Number(text.includes(token)), 0)
      return score > current.score ? { passage, score } : current
    },
    { passage: passages[0] ?? { sectionTitle: fallbackTitle, paragraph: '' }, score: -1 }
  ).passage
  return {
    sectionTitle: best.sectionTitle,
    paragraph: best.paragraph.slice(0, PASSAGE_LIMIT),
    truncated: best.paragraph.length > PASSAGE_LIMIT
  }
}

function splitPassages(markdown: string, fallbackTitle: string): SearchPassage[] {
  const passages: SearchPassage[] = []
  let sectionTitle = fallbackTitle
  let lines: string[] = []
  const flush = (): void => {
    const paragraph = lines.join('\n').trim()
    if (paragraph) passages.push({ sectionTitle, paragraph, truncated: false })
    lines = []
  }

  for (const line of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const heading = /^#{1,6}\s+(.+?)\s*$/u.exec(line)
    if (heading) {
      flush()
      sectionTitle = heading[1]
    } else if (line.trim()) {
      lines.push(line)
    } else {
      flush()
    }
  }
  flush()
  return passages
}
