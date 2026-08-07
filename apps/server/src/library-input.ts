import { isUrlInScope, normalizeScopePath, parseGithubRepositoryUrl } from '@loci/core'
import { ConflictError } from './database-errors.js'

export function normalizeLibraryScope(url: string, hostname: string, input: string): string {
  const repository = parseGithubRepositoryUrl(url)
  if (repository) return new URL(repository.url).pathname
  const scopePath = normalizeScopePath(input)
  if (!isUrlInScope(url, hostname, scopePath)) {
    throw new ConflictError('收录范围必须包含第一个页面')
  }
  return scopePath
}
