import type { CrawlNode, CrawlRunState } from '../types'

export function indexCrawlRuns(runs: CrawlRunState[]): Record<string, CrawlRunState> {
  return Object.fromEntries(runs.map((run) => [run.sourceId, run]))
}

export function mergeCrawlNode(nodes: CrawlNode[], node: CrawlNode | undefined): CrawlNode[] {
  if (!node) return nodes
  const index = nodes.findIndex((item) => item.id === node.id)
  return index < 0
    ? [...nodes, node]
    : nodes.map((item, itemIndex) => (itemIndex === index ? node : item))
}
