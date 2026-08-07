import { posix } from 'node:path'
import type { Definition, Image, Link, Nodes, Parent } from 'mdast'
import { frontmatterFromMarkdown, frontmatterToMarkdown } from 'mdast-util-frontmatter'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import { frontmatter } from 'micromark-extension-frontmatter'
import type { GithubRepository } from './github-url.js'

interface RewriteContext {
  repository: GithubRepository
  revision: string
  relativePath: string
}

/** 只处理 Markdown AST 的链接节点，避免改动代码块和普通正文。 */
export function rewriteGithubMarkdown(markdown: string, context: RewriteContext): string {
  const matters: Array<'yaml' | 'toml'> = ['yaml', 'toml']
  const tree = fromMarkdown(markdown, {
    extensions: [frontmatter(matters)],
    mdastExtensions: [frontmatterFromMarkdown(matters)]
  })
  rewriteChildren(tree, context)
  return toMarkdown(tree, { extensions: [frontmatterToMarkdown(matters)] })
}

function rewriteChildren(parent: Parent, context: RewriteContext): void {
  for (const node of parent.children) {
    if (isUrlNode(node)) {
      node.url = rewriteUrl(node.url, node.type === 'image', context)
    }
    if ('children' in node && Array.isArray(node.children)) {
      rewriteChildren(node as Parent, context)
    }
  }
}

function isUrlNode(node: Nodes): node is Definition | Image | Link {
  return node.type === 'definition' || node.type === 'image' || node.type === 'link'
}

function rewriteUrl(url: string, image: boolean, context: RewriteContext): string {
  if (isExternalOrLocalReference(url)) return url
  const { pathname, suffix } = splitUrlSuffix(url)
  if (!pathname) return url
  const base = pathname.startsWith('/') ? '' : posix.dirname(context.relativePath)
  const relativePath = posix.normalize(posix.join(base, pathname.replace(/^\/+/, '')))
  if (!relativePath || relativePath === '.' || relativePath.startsWith('../')) return url
  const segments = relativePath.split('/').map(encodeURIComponent).join('/')
  const owner = encodeURIComponent(context.repository.owner)
  const repo = encodeURIComponent(context.repository.repo)
  const revision = encodeURIComponent(context.revision)
  const baseUrl = image
    ? `https://raw.githubusercontent.com/${owner}/${repo}/${revision}`
    : `https://github.com/${owner}/${repo}/blob/${revision}`
  return `${baseUrl}/${segments}${suffix}`
}

function isExternalOrLocalReference(url: string): boolean {
  return !url || url.startsWith('#') || url.startsWith('//') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(url)
}

function splitUrlSuffix(url: string): { pathname: string; suffix: string } {
  const index = url.search(/[?#]/)
  return index < 0
    ? { pathname: url, suffix: '' }
    : { pathname: url.slice(0, index), suffix: url.slice(index) }
}
