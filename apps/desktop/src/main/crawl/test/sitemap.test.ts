import { describe, expect, it } from 'vitest'
import { parseSitemap } from '@loci/core'

describe('parseSitemap', () => {
  it('keeps normalized same-host URLs up to the limit', () => {
    const xml =
      '<urlset><url><loc>/one?a=1</loc></url><url><loc>https://other.example.com/no</loc></url><url><loc>/two#top</loc></url></urlset>'
    expect(parseSitemap(xml, 'https://docs.example.com/start', 'docs.example.com', 10)).toEqual([
      'https://docs.example.com/one',
      'https://docs.example.com/two'
    ])
  })
})
