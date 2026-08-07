export const DEFAULT_GITHUB_ARCHIVE_LIMIT_BYTES = 200 * 1024 * 1024
export const DEFAULT_GITHUB_MARKDOWN_LIMIT_BYTES = 100 * 1024 * 1024
export const GITHUB_SINGLE_MARKDOWN_LIMIT_BYTES = 5 * 1024 * 1024

export type GithubLimitKind = 'archive' | 'markdown'

export interface GithubBlockedState {
  revision: string
  kind: GithubLimitKind
  limitBytes: number
}

export class GithubLimitError extends Error {
  constructor(
    message: string,
    readonly revision: string,
    readonly kind: GithubLimitKind,
    readonly limitBytes: number
  ) {
    super(message)
    this.name = 'GithubLimitError'
  }
}

export function formatGithubBytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}
