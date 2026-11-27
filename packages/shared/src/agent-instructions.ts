export const LOCI_INSTRUCTIONS_START = '<!-- loci:start -->'
export const LOCI_INSTRUCTIONS_END = '<!-- loci:end -->'
export const LOCI_CONTEXT7_COMPATIBILITY = '<!-- loci:context7 -->'

const LOCI_INSTRUCTIONS_BODY = `# Technical documentation with the local Loci CLI

Use local documentation for questions about a library's API, configuration, version, or migration.
Identify the project's version before choosing sources. For non-documentation questions (error
troubleshooting, issues/PRs, community discussions, blogs, comparisons, release highlights, or
general web research), use web search or the relevant source directly instead of Loci.

1. Run \`loci list --json\` to find a local library matching the technology and version.
   List categories and counts with \`loci category --json\`. Filter by exact labels with \`loci list --category <name> --version <ver> --json\`.
2. Browse with \`loci tree <lib> --json\` or filter with \`loci tree <lib> --query <kw...> --json\`.
   Run \`loci search <queries...> --json\` across libraries, or \`loci search <queries...> --library <lib> --tree --json\` for a matching tree. Use identifiers and error messages verbatim.
3. Read the matching document IDs or subtree paths with \`loci read <targets...> --library <lib> --json\`.
   For a search with full deduplicated sections, use \`loci search <queries...> --library <lib> --content --json\` and pass \`nextOffset\` and \`nextPageToken\` as \`--offset\` and \`--page-token\` for more hits. Restart from the first page if the results changed.
   Cite the source URLs from the text you read.
4. When the library is missing, verify the official documentation URL and run \`loci fetch <url>\`
   directly (use \`--pages\` when only specific known pages are needed).
   If the local documentation is stale, refresh it with \`loci update <lib>\`.
   Both commands accept \`--category <name>\` and \`--version <ver>\`. New categories are created automatically. New libraries default to 未分类 and latest. Existing libraries keep their labels unless explicitly changed. The same source can have independent libraries for different versions.
   Both commands return asynchronously by default. If another crawl with different targets is running, wait for it to finish before resubmitting. Add \`--wait\` to wait in the foreground.
5. Poll \`loci status <lib> --json\` until the crawl reaches a terminal status. Inspect \`error\` and the
   page URLs and messages in \`failures\` for partial or failed crawls. Use \`loci cancel <lib>\` to cancel
   a running crawl, or \`loci status --json\` to check all libraries with crawl records. Repeat the search and read after acquisition.
6. When the user requests edits, inspect sections with \`loci doc sections <doc> --library <lib> --json\`.
   Use \`loci doc update <doc> --library <lib> --file <file>\` to replace the document text or
   \`loci delete <lib> --doc <targets...>\` to delete selected documents. \`loci delete <lib>\` deletes the entire library.
7. For backups, run \`loci data export <file>\` for all data or select libraries with \`--category <name...>\` and \`--library <lib...>\`. Import merges by default: matching library IDs or source/version pairs are deleted and restored from the archive. Legacy read-only snapshots match by original server and remote library ID. Other libraries are retained. Use \`--replace-all\` only for an explicitly requested full replacement.

Deletion, deliberate overwrites, and existing source configuration changes require explicit user authorization.
Narrowing the source scope or changing exclusions can immediately remove stored documents and their search entries.
For an authorized non-interactive deletion, overwrite, or content-pruning change, pass \`--yes\`.
Use \`loci data clear-documents --yes\` only when authorized to empty the documents in every library, and \`loci data clear-sources --yes\` only when authorized to delete every library.`

const CONTEXT7_FALLBACK = `${LOCI_CONTEXT7_COMPATIBILITY}
## Context7 fallback

For detailed developer documentation questions, prefer Loci and use Context7 for unresolved
concepts when Loci is unavailable, acquisition fails, evidence is insufficient, or acquisition
would be disproportionate. Do not require a full crawl or a crawl-permission question first.
Lightweight research and non-documentation tasks can use appropriate web sources directly without
exhausting Loci. Loading a Context7 skill does not change this routing. If the user explicitly
requests Context7, follow that request directly.

When falling back:

1. State why Loci was insufficient, then run
   \`npx ctx7@latest library <name> "<user's question>"\` unless the user supplied a valid library ID.
2. Choose the closest official or high-reputation match, preferring a version-specific ID when the
   project version is known.
3. Run \`npx ctx7@latest docs <libraryId> "<user's question>"\`. Use separate requests for distinct
   concepts, but do not exceed three Context7 CLI requests for one question.
4. Never include API keys, passwords, tokens, or other credentials in a query.
5. Report quota failures and suggest \`npx ctx7@latest login\` or \`CONTEXT7_API_KEY\`; do not silently
   answer from memory.
6. If a request fails because of DNS or network access, retry outside Codex's default sandbox.`

export const LOCI_AGENT_INSTRUCTIONS = createManagedBlock(LOCI_INSTRUCTIONS_BODY)
export const LOCI_CONTEXT7_AGENT_INSTRUCTIONS = createManagedBlock(
  `${LOCI_INSTRUCTIONS_BODY}\n\n${CONTEXT7_FALLBACK}`
)

interface MergeLociAgentInstructionsOptions {
  migrateContext7?: boolean
  context7Available?: boolean
}

interface ManagedRange {
  start: number
  end: number
}

/** 只替换 Loci 管理的区块；Codex 可同时迁移有明确边界的 Context7 规则。 */
export function mergeLociAgentInstructions(
  current: string,
  options: MergeLociAgentInstructionsOptions = {}
): string {
  const ranges = findLociRanges(current)
  const [lociRange, ...duplicates] = ranges
  // 只合并完整成对的 Loci 区块，保留区块之间的个人规则。
  const content = duplicates.reduceRight((text, range) => replaceRange(text, range, ''), current)
  const context7Range = options.migrateContext7 ? findContext7Range(content, lociRange) : undefined
  const useContext7 =
    options.context7Available === true ||
    context7Range !== undefined ||
    ranges.some((range) =>
      current.slice(range.start, range.end).includes(LOCI_CONTEXT7_COMPATIBILITY)
    )
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const block = (
    useContext7 ? LOCI_CONTEXT7_AGENT_INSTRUCTIONS : LOCI_AGENT_INSTRUCTIONS
  ).replaceAll('\n', newline)

  if (context7Range && !lociRange) {
    return replaceRange(content, context7Range, block)
  }

  const withoutContext7 = context7Range ? replaceRange(content, context7Range, '') : content
  return mergeManagedBlock(withoutContext7, block, newline)
}

export function hasContext7Compatibility(content: string): boolean {
  return findLociRanges(content).some((range) =>
    content.slice(range.start, range.end).includes(LOCI_CONTEXT7_COMPATIBILITY)
  )
}

/** 检查 Loci 受管区块；异常边界继续抛错，避免把冲突误报为缺失。 */
export function hasLociAgentInstructions(content: string): boolean {
  return findLociRanges(content).length > 0
}

/** 只移除 Loci 受管区块，保留同一文件中的其他用户规则。 */
export function removeLociAgentInstructions(content: string): {
  content: string
  removed: boolean
} {
  const ranges = findLociRanges(content)
  if (!ranges.length) return { content, removed: false }
  const next = ranges
    .reduceRight((text, range) => replaceRange(text, range, ''), content)
    .replace(/^(?:\r?\n){2,}/, '')
    .replace(/(?:\r?\n){3,}/g, '\n\n')
  return {
    content: next.trim() ? `${next.trimEnd()}\n` : '',
    removed: true
  }
}

function createManagedBlock(body: string): string {
  return `${LOCI_INSTRUCTIONS_START}\n${body}\n${LOCI_INSTRUCTIONS_END}`
}

function findLociRanges(content: string): ManagedRange[] {
  const starts = [...content.matchAll(/^<!-- loci:start -->(?=\r?$)/gm)]
  const ends = [...content.matchAll(/^<!-- loci:end -->(?=\r?$)/gm)]
  if (starts.length !== ends.length) {
    throw new Error('Loci 全局规则标记不完整，请先补齐成对的 loci:start 和 loci:end')
  }
  const ranges = starts.map((start, index) => toRange(start, ends[index], 'Loci 全局规则'))
  if (ranges.some((range, index) => index > 0 && ranges[index - 1].end > range.start)) {
    throw new Error('Loci 全局规则标记相互嵌套，请先修复区块边界')
  }
  return ranges
}

function findContext7Range(
  content: string,
  lociRange: ManagedRange | undefined
): ManagedRange | undefined {
  const outsideLoci = lociRange ? maskRange(content, lociRange) : content
  const legacy = [...outsideLoci.matchAll(/^<!-- context7 -->(?=\r?$)/gim)]
  const starts = [...outsideLoci.matchAll(/^<!-- context7:start -->(?=\r?$)/gim)]
  const ends = [...outsideLoci.matchAll(/^<!-- context7:end -->(?=\r?$)/gim)]
  const lociContext7Starts = [...outsideLoci.matchAll(/^<!-- loci-context7:start -->(?=\r?$)/gim)]
  const lociContext7Ends = [...outsideLoci.matchAll(/^<!-- loci-context7:end -->(?=\r?$)/gim)]
  const hasStructured = starts.length > 0 || ends.length > 0
  const hasLegacyLociContext7 = lociContext7Starts.length > 0 || lociContext7Ends.length > 0
  const markerStyles = [legacy.length > 0, hasStructured, hasLegacyLociContext7].filter(
    Boolean
  ).length

  if (markerStyles > 1) {
    throw new Error('Context7 全局规则标记重复，请先手动修复')
  }
  if (legacy.length === 2) return toRange(legacy[0], legacy[1], 'Context7 全局规则')
  if (legacy.length > 0) {
    throw new Error('Context7 全局规则标记不完整或重复，请先手动修复')
  }
  if (starts.length === 1 && ends.length === 1) {
    return toRange(starts[0], ends[0], 'Context7 全局规则')
  }
  if (hasStructured) {
    throw new Error('Context7 全局规则标记不完整或重复，请先手动修复')
  }
  if (lociContext7Starts.length === 1 && lociContext7Ends.length === 1) {
    return toRange(lociContext7Starts[0], lociContext7Ends[0], '旧版 Loci 与 Context7 全局规则')
  }
  if (hasLegacyLociContext7) {
    throw new Error('旧版 Loci 与 Context7 全局规则标记不完整或重复，请先手动修复')
  }
  if (/\bnpx\s+ctx7(?:@|\s)|\bctx7\s+(?:library|docs)\b/i.test(outsideLoci)) {
    throw new Error('检测到未受标记管理的 Context7 规则，无法安全替换，请先手动添加边界')
  }
  return undefined
}

function toRange(
  startMatch: RegExpMatchArray,
  endMatch: RegExpMatchArray,
  label: string
): ManagedRange {
  const start = startMatch.index
  const end = endMatch.index
  if (start === undefined || end === undefined || end < start) {
    throw new Error(`${label}标记顺序无效，请先手动修复`)
  }
  return { start, end: end + endMatch[0].length }
}

function maskRange(content: string, range: ManagedRange): string {
  return `${content.slice(0, range.start)}${content
    .slice(range.start, range.end)
    .replace(/[^\r\n]/g, ' ')}${content.slice(range.end)}`
}

function replaceRange(content: string, range: ManagedRange, replacement: string): string {
  return `${content.slice(0, range.start)}${replacement}${content.slice(range.end)}`
}

function mergeManagedBlock(content: string, block: string, newline: string): string {
  const [range] = findLociRanges(content)
  if (range) return replaceRange(content, range, block)
  if (!content) return `${block}${newline}`
  const separator = content.endsWith(`${newline}${newline}`)
    ? ''
    : content.endsWith(newline)
      ? newline
      : `${newline}${newline}`
  return `${content}${separator}${block}${newline}`
}
