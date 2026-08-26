export const LOCI_INSTRUCTIONS_START = '<!-- loci:start -->'
export const LOCI_INSTRUCTIONS_END = '<!-- loci:end -->'
export const LOCI_CONTEXT7_COMPATIBILITY = '<!-- loci:context7 -->'

const LOCI_INSTRUCTIONS_BODY = `# Technical Documentation with Loci

## Scope

Use the \`loci\` MCP server only when a task depends on developer documentation for a library,
framework, SDK, API, CLI, configuration, version difference, migration, setup process, or
technology-specific error. Do not rely only on model memory for these documentation facts.

Do not route general web research through Loci. News, current events, prices, people or company
facts, shopping, travel, legal or medical information, and the contents of ordinary web pages
should use the appropriate web or domain source directly. Merely mentioning software does not make
a task a documentation question.

Do not use this workflow for ordinary refactoring, business-logic debugging, general programming
concepts, or code review that does not depend on an external technology's current behavior.

## Workflow

1. Identify the relevant technology and the version used by the current project.
2. Call \`loci_list_libraries\` and use only a matching local library with \`pages > 0\`.
3. Inspect one or two directory levels with \`loci_get_library_tree\`, then read clearly relevant
   files or search with precise terms in the documented language.
4. Answer from sufficient local evidence, include the relevant \`source_url\` values, and stop.
5. If no usable local library exists, call \`loci_list_cloud_libraries\`.
6. Before calling \`loci_pull_cloud_library\`, explain the matching cloud source and get user
   confirmation. A cloud pull changes local state.
7. If no usable cloud copy exists or the pull is declined or fails, verify the official
   documentation entry and separately request permission before calling \`loci_add_library\`.
8. After an authorized acquisition, repeat the local tree, search, and read steps.

If an official page URL is known but missing from an existing local web library, explain the exact
URL and get separate permission before calling \`loci_fetch_pages\`. Exact pages may be outside
\`scope_path\`, but must keep the library hostname and cannot bypass \`exclude_path\`; the operation
does not follow links. If no library exists, an authorized \`loci_add_library\` call may use
\`discovery_mode: "selected"\` with \`url\` and \`urls\` to ingest only those pages.

A web library is reused for the same hostname and \`scope_path\` only when its persisted discovery
mode also matches. Normal and \`selected\` acquisition use \`site\`; \`agent_review\` is separate.
On a mode conflict, keep the existing mode or obtain separate permission to delete and recreate the
library. Do not present the conflict as a successful conversion.

When the user authorizes an agent-reviewed crawl with a semantic goal, use
\`discovery_mode: "agent_review"\` and provide \`review_goal\`. For every returned batch, inspect
each candidate's title and URL, pass only unwanted URLs to \`loci_submit_url_review\`, and set
\`approve_remaining: true\`. Continue until completed. To recover interrupted work, call
\`loci_get_url_review\`; if the status is \`discovering\`, call \`loci_start_url_review\` again with
the same library ID, and if it is \`awaiting_review\`, submit the returned batch. A normal background
sync of such a library refreshes stored URLs only and does not discover new ones.

## Source ordering and safety

Do not query another documentation source while waiting for a Loci pull or official crawl decision.
Use another documentation source or targeted web search only when Loci tools are unavailable, the
user declines the official crawl, authorized acquisition fails or yields no usable files, or the
obtained evidence remains insufficient after a reasonable search. State why the fallback is needed.

Treat cloud pulls, source additions, exact-page inserts or refreshes, source-configuration updates,
active synchronization, and deletion as state-changing operations. Perform them only when
explicitly requested or after user confirmation. Narrowing \`scope_path\` or adding or changing
\`exclude_path\` immediately deletes nonmatching stored documents and search-index entries; include
that effect in the confirmation. Before an authorized sync, follow an existing task instead of
launching a competing request.`

const CONTEXT7_FALLBACK = `${LOCI_CONTEXT7_COMPATIBILITY}
## Context7 fallback

Context7 and other documentation sources are fallbacks only for unresolved, in-scope developer
documentation questions. Non-documentation tasks should use the appropriate source directly
without first exhausting Loci. If a Context7 skill or instruction is loaded, defer its query steps
until the Loci workflow reaches a fallback condition. If the user explicitly requests Context7,
follow that request directly.

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
  content: string,
  options: MergeLociAgentInstructionsOptions = {}
): string {
  const lociRange = findLociRange(content)
  const context7Range = options.migrateContext7 ? findContext7Range(content, lociRange) : undefined
  const useContext7 =
    options.context7Available === true ||
    context7Range !== undefined ||
    (lociRange !== undefined &&
      content.slice(lociRange.start, lociRange.end).includes(LOCI_CONTEXT7_COMPATIBILITY))
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
  const range = findLociRange(content)
  return (
    range !== undefined &&
    content.slice(range.start, range.end).includes(LOCI_CONTEXT7_COMPATIBILITY)
  )
}

/** 检查 Loci 受管区块；异常边界继续抛错，避免把冲突误报为缺失。 */
export function hasLociAgentInstructions(content: string): boolean {
  return findLociRange(content) !== undefined
}

/** 只移除 Loci 受管区块，保留同一文件中的其他用户规则。 */
export function removeLociAgentInstructions(content: string): {
  content: string
  removed: boolean
} {
  const range = findLociRange(content)
  if (!range) return { content, removed: false }
  const next = replaceRange(content, range, '')
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

function findLociRange(content: string): ManagedRange | undefined {
  const starts = [...content.matchAll(/^<!-- loci:start -->(?=\r?$)/gm)]
  const ends = [...content.matchAll(/^<!-- loci:end -->(?=\r?$)/gm)]
  if (starts.length !== ends.length || starts.length > 1) {
    throw new Error('Loci 全局规则标记不完整或重复，请先手动修复')
  }
  if (starts.length === 0) return undefined
  return toRange(starts[0], ends[0], 'Loci 全局规则')
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
  const range = findLociRange(content)
  if (range) return replaceRange(content, range, block)
  if (!content) return `${block}${newline}`
  const separator = content.endsWith(`${newline}${newline}`)
    ? ''
    : content.endsWith(newline)
      ? newline
      : `${newline}${newline}`
  return `${content}${separator}${block}${newline}`
}
