export const LOCI_INSTRUCTIONS_START = '<!-- loci:start -->'
export const LOCI_INSTRUCTIONS_END = '<!-- loci:end -->'

export const LOCI_AGENT_INSTRUCTIONS = `${LOCI_INSTRUCTIONS_START}
# Technical Documentation with Loci

Use the \`loci\` MCP server whenever a task depends on current information about a library,
framework, SDK, API, CLI, configuration, version difference, migration, setup process, or
library-specific error. Do not rely only on model memory.

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

## Source ordering and safety

Do not query another documentation source while waiting for a Loci pull or official crawl decision.
Use another source only when Loci tools are unavailable, the user declines the official crawl,
authorized acquisition fails or yields no usable files, or the obtained evidence remains
insufficient after a reasonable search. State why the fallback is needed.

Treat cloud pulls, source additions, active synchronization, and deletion as state-changing
operations. Perform them only when explicitly requested or after user confirmation. Before an
authorized sync, follow an existing task instead of launching a competing request.
${LOCI_INSTRUCTIONS_END}`

/** 只替换 Loci 管理的区块，保留文件中的其他个人规则。 */
export function mergeLociAgentInstructions(content: string): string {
  const starts = [...content.matchAll(/^<!-- loci:start -->(?=\r?$)/gm)]
  const ends = [...content.matchAll(/^<!-- loci:end -->(?=\r?$)/gm)]
  if (starts.length !== ends.length || starts.length > 1) {
    throw new Error('Loci 全局规则标记不完整或重复，请先手动修复')
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const block = LOCI_AGENT_INSTRUCTIONS.replaceAll('\n', newline)
  if (starts.length === 0) {
    if (!content) return `${block}${newline}`
    const separator = content.endsWith(`${newline}${newline}`)
      ? ''
      : content.endsWith(newline)
        ? newline
        : `${newline}${newline}`
    return `${content}${separator}${block}${newline}`
  }

  const start = starts[0].index
  const end = ends[0].index
  if (start === undefined || end === undefined || end < start) {
    throw new Error('Loci 全局规则标记顺序无效，请先手动修复')
  }
  const afterEnd = end + ends[0][0].length
  return `${content.slice(0, start)}${block}${content.slice(afterEnd)}`
}
