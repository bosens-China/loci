import { defaultUrlTransform } from 'react-markdown'

/** 先复用渲染器的协议校验，再按来源解析；不允许相对地址落到本机控制台。 */
export function resolveReaderUrl(value: string, sourceUrl: string): string {
  const safe = defaultUrlTransform(value)
  if (!safe) return safe
  if (safe.startsWith('#')) return `#doc-${safe.slice(1)}`
  try {
    return new URL(safe, sourceUrl).href
  } catch {
    return ''
  }
}

/** 自定义锚点属于 Markdown 语法，不作为目录标题展示。 */
export function readerTitle(value: string): string {
  return value.replace(/\s+\{#[\w-]+\}\s*$/u, '')
}

interface MarkdownNode {
  type: string
  value?: string
  children?: MarkdownNode[]
  data?: { hProperties?: Record<string, unknown> }
}

/** 在语法树中保留标题锚点，统一加前缀避免与控制台元素冲突。 */
export function remarkReaderHeadings() {
  return (tree: MarkdownNode): void => {
    const ids = new Map<string, number>()
    const text = (node: MarkdownNode): string =>
      node.value ?? node.children?.map(text).join('') ?? ''
    const visit = (node: MarkdownNode): void => {
      if (node.type === 'heading') {
        const last = node.children?.at(-1)
        const explicit =
          last?.type === 'text' ? /\s+\{#([\w-]+)\}\s*$/u.exec(last.value ?? '') : null
        if (explicit && last?.value) last.value = readerTitle(last.value)
        const slug =
          explicit?.[1] ??
          text(node)
            .toLowerCase()
            .replace(/[^\p{L}\p{N}_\s-]/gu, '')
            .replace(/\s+/gu, '-')
        const count = ids.get(slug) ?? 0
        ids.set(slug, count + 1)
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, id: `doc-${slug}${count ? `-${count}` : ''}` }
        }
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

/** 只清理阅读视图的展示包装；围栏代码和行内代码保持原样，绝不执行源站 MDX。 */
export function normalizeReaderMarkdown(content: string): string {
  const header = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)
  const body = header && /^[\w-]+:\s/mu.test(header[1]!) ? content.slice(header[0].length) : content
  let fence: { marker: string; length: number } | undefined
  let containers = 0
  return body
    .split('\n')
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
      if (fence) {
        if (
          marker &&
          marker[1]![0] === fence.marker &&
          marker[1]!.length >= fence.length &&
          !marker[2]!.trim()
        ) {
          fence = undefined
        }
        return line
      }
      if (marker) {
        fence = { marker: marker[1]![0]!, length: marker[1]!.length }
        return line
      }
      // 缩进代码块同样不能被当作 MDX 包装清理。
      if (/^(?: {4}|\t)/u.test(line)) return line
      const container = /^ {0,3}:::(info|tip|warning|danger|details)(?:[ \t]+(.*?))?\s*$/u.exec(
        line
      )
      if (container) {
        containers++
        return `**${container[2] || container[1]}**\n`
      }
      if (containers && /^ {0,3}:::\s*$/u.test(line)) {
        containers--
        return ''
      }
      return line.replace(
        /(?<!`)(`+)(?!`)[^\n]*?(?<!`)\1(?!`)|<\/?[A-Z][\w.]*(?:\s[^<>]*?)?\s*\/?>|\{\/\*.*?\*\/\}/gu,
        (token) => (token.startsWith('`') ? token : '')
      )
    })
    .join('\n')
}
