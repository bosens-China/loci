export interface GithubRepository {
  owner: string
  repo: string
  url: string
  identity: string
}

const githubHostname = 'github.com'
const invalidRepositorySegments = new Set([
  'collections',
  'events',
  'explore',
  'features',
  'issues',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'pulls',
  'search',
  'settings',
  'sponsors',
  'topics',
  'trending'
])

/** 从任意仓库内 GitHub URL 解析公开仓库身份，并统一回到仓库首页。 */
export function parseGithubRepositoryUrl(input: string): GithubRepository | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.hostname.toLowerCase() !== githubHostname) return null
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const owner = segments[0]!
  const repo = segments[1]!.replace(/\.git$/i, '')
  if (!owner || !repo || invalidRepositorySegments.has(owner.toLowerCase())) return null
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null
  const canonicalUrl = `https://${githubHostname}/${owner}/${repo}`
  return {
    owner,
    repo,
    url: canonicalUrl,
    identity: `github:${owner.toLowerCase()}/${repo.toLowerCase()}`
  }
}

export function isGithubRepositoryUrl(input: string): boolean {
  return parseGithubRepositoryUrl(input) !== null
}
