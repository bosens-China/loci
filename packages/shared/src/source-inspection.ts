/** 只读来源探测的传输契约，供抓取器和本机 Web 共用。 */
export type SourceInspectionDiscovery = 'github' | 'llms' | 'openapi' | 'sitemap' | 'unknown'
export type SourceEstimateKind = 'exact' | 'lower_bound' | 'unknown'

export interface SourcePathGroup {
  path: string
  pages: number
}

export interface SourceInspection {
  url: string
  hostname: string
  kind: 'web' | 'github'
  scopePath: string
  discovery: SourceInspectionDiscovery
  estimateKind: SourceEstimateKind
  estimatedPages: number | null
  discoveredPages: number
  excludedPages: number
  exceedsHardLimit: boolean
  hardPageLimit: number
  pathGroups: SourcePathGroup[]
  githubDefaultBranch?: string
  githubRevision?: string
}
