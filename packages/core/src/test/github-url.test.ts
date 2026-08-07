import { describe, expect, it } from 'vitest'
import { parseGithubRepositoryUrl } from '../github-url.js'

describe('parseGithubRepositoryUrl', () => {
  it('normalizes repository and nested URLs', () => {
    expect(parseGithubRepositoryUrl('https://github.com/vuejs/docs/tree/main/src')).toEqual({
      owner: 'vuejs',
      repo: 'docs',
      url: 'https://github.com/vuejs/docs',
      identity: 'github:vuejs/docs'
    })
    expect(parseGithubRepositoryUrl('https://github.com/VueJS/Docs.git')?.identity).toBe(
      'github:vuejs/docs'
    )
  })

  it('does not mistake GitHub product pages for repositories', () => {
    expect(parseGithubRepositoryUrl('https://github.com/search?q=loci')).toBeNull()
    expect(parseGithubRepositoryUrl('https://example.com/vuejs/docs')).toBeNull()
  })
})
