import { describe, expect, it } from 'vitest'
import {
  findSkippedReleaseTags,
  planSkippedReleaseTags,
  type PlannedReleaseTag,
  type ReleaseTagRepository
} from '../sync-skipped-release-tags.mts'

class MemoryReleaseTagRepository implements ReleaseTagRepository {
  readonly created: PlannedReleaseTag[] = []

  constructor(
    private readonly commits: string[],
    private readonly manifests: Record<string, Record<string, unknown>>,
    private readonly tags = new Map<string, string>()
  ) {}

  async listManifestCommits(): Promise<string[]> {
    return this.commits
  }

  async readManifestAt(commitSha: string): Promise<Record<string, unknown>> {
    return this.manifests[commitSha] ?? {}
  }

  async resolveTag(tagName: string): Promise<string | null> {
    return this.tags.get(tagName) ?? null
  }

  async createTags(tags: PlannedReleaseTag[]): Promise<void> {
    this.created.push(...tags)
  }
}

const config = {
  packages: {
    'apps/cli': { component: 'cli' },
    'packages/core': {
      component: 'core',
      'skip-github-release': true
    },
    'packages/shared': {
      component: 'shared',
      'include-v-in-tag': false,
      'tag-separator': '/',
      'skip-github-release': true
    }
  }
}

describe('findSkippedReleaseTags', () => {
  it('只生成 skip-github-release 组件的标签', () => {
    expect(
      findSkippedReleaseTags(config, {
        'apps/cli': '1.6.0',
        'packages/core': '1.4.0',
        'packages/shared': '1.8.0'
      })
    ).toEqual([
      {
        packagePath: 'packages/core',
        tagName: 'core-v1.4.0',
        version: '1.4.0'
      },
      {
        packagePath: 'packages/shared',
        tagName: 'shared/1.8.0',
        version: '1.8.0'
      }
    ])
  })
})

describe('planSkippedReleaseTags', () => {
  const releaseTag = {
    packagePath: 'packages/core',
    tagName: 'core-v1.4.0',
    version: '1.4.0'
  }
  const manifests = {
    newest: { 'packages/core': '1.4.0' },
    previous: { 'packages/core': '1.3.0' }
  }

  it('使用 first-parent manifest 历史中的版本提交', async () => {
    const repository = new MemoryReleaseTagRepository(['newest', 'previous'], manifests)

    await expect(planSkippedReleaseTags(repository, [releaseTag])).resolves.toEqual([
      { ...releaseTag, targetSha: 'newest' }
    ])
  })

  it('标签已经指向正确提交时保持幂等', async () => {
    const repository = new MemoryReleaseTagRepository(
      ['newest', 'previous'],
      manifests,
      new Map([['core-v1.4.0', 'newest']])
    )

    await expect(planSkippedReleaseTags(repository, [releaseTag])).resolves.toEqual([])
  })

  it('拒绝覆盖指向其他提交的既有标签', async () => {
    const repository = new MemoryReleaseTagRepository(
      ['newest', 'previous'],
      manifests,
      new Map([['core-v1.4.0', 'unexpected']])
    )

    await expect(planSkippedReleaseTags(repository, [releaseTag])).rejects.toThrow(
      'core-v1.4.0 已指向 unexpected，预期为 newest'
    )
  })

  it('找不到版本对应提交时失败', async () => {
    const repository = new MemoryReleaseTagRepository(['previous'], manifests)

    await expect(planSkippedReleaseTags(repository, [releaseTag])).rejects.toThrow(
      '找不到 packages/core 1.4.0 对应的 manifest 提交'
    )
  })
})
