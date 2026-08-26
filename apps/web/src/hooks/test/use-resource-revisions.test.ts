import { describe, expect, it } from 'vitest'
import type { ResourceRevisions } from '@loci/shared'
import { getChangedResourceQueryKeys } from '@/hooks/use-resource-revisions'

const initial: ResourceRevisions = { sources: 1, documents: 2, jobs: 3, settings: 4 }

describe('资源 revision Query 映射', () => {
  it('首次读取只建立基线，不重复刷新页面 Query', () => {
    expect(getChangedResourceQueryKeys(undefined, initial)).toEqual([])
  })

  it.each([
    ['sources', [['sources']]],
    ['documents', [['documents'], ['document']]],
    ['jobs', [['jobs']]],
    ['settings', [['settings']]]
  ] as const)('只失效变化的 %s 资源 Query', (resource, expected) => {
    expect(
      getChangedResourceQueryKeys(initial, { ...initial, [resource]: initial[resource] + 1 })
    ).toEqual(expected)
  })
})
