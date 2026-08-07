import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  findSkippedReleaseTags,
  GitReleaseTagRepository,
  planSkippedReleaseTags,
  type PlannedReleaseTag,
  type ReleaseTagRepository
} from '../sync-skipped-release-tags.mts'

const execFileAsync = promisify(execFile)

async function git(workspaceRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: workspaceRoot })
  return stdout.trim()
}

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
    followUpRelease: { 'packages/core': '1.4.0' },
    releaseCommit: { 'packages/core': '1.4.0' },
    previous: { 'packages/core': '1.3.0' }
  }

  it('使用 first-parent manifest 历史中的版本提交', async () => {
    const repository = new MemoryReleaseTagRepository(
      ['followUpRelease', 'releaseCommit', 'previous'],
      manifests
    )

    await expect(planSkippedReleaseTags(repository, [releaseTag])).resolves.toEqual([
      { ...releaseTag, targetSha: 'releaseCommit' }
    ])
  })

  it('后续仅发布其他包时，既有标签保持幂等', async () => {
    const repository = new MemoryReleaseTagRepository(
      ['followUpRelease', 'releaseCommit', 'previous'],
      manifests,
      new Map([['core-v1.4.0', 'releaseCommit']])
    )

    await expect(planSkippedReleaseTags(repository, [releaseTag])).resolves.toEqual([])
  })

  it('拒绝覆盖指向其他提交的既有标签', async () => {
    const repository = new MemoryReleaseTagRepository(
      ['followUpRelease', 'releaseCommit', 'previous'],
      manifests,
      new Map([['core-v1.4.0', 'unexpected']])
    )

    await expect(planSkippedReleaseTags(repository, [releaseTag])).rejects.toThrow(
      'core-v1.4.0 已指向 unexpected，预期为 releaseCommit'
    )
  })

  it('找不到版本对应提交时失败', async () => {
    const repository = new MemoryReleaseTagRepository(['previous'], manifests)

    await expect(planSkippedReleaseTags(repository, [releaseTag])).rejects.toThrow(
      '找不到 packages/core 1.4.0 对应的 manifest 提交'
    )
  })
})

describe('GitReleaseTagRepository', () => {
  it('发布提交位于 merge 第二父时仍复用已有标签', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'loci-release-tag-'))

    try {
      await git(workspaceRoot, ['init', '--initial-branch=master'])
      await git(workspaceRoot, ['config', 'user.name', 'Loci Test'])
      await git(workspaceRoot, ['config', 'user.email', 'test@loci.local'])
      await writeFile(
        join(workspaceRoot, '.release-please-manifest.json'),
        '{"packages/shared":"1.11.0"}\n'
      )
      await git(workspaceRoot, ['add', '.release-please-manifest.json'])
      await git(workspaceRoot, ['commit', '-m', 'previous release'])
      await git(workspaceRoot, ['checkout', '-b', 'release'])
      await writeFile(
        join(workspaceRoot, '.release-please-manifest.json'),
        '{"packages/shared":"1.12.0"}\n'
      )
      await git(workspaceRoot, ['commit', '-am', 'release shared'])
      const releaseSha = await git(workspaceRoot, ['rev-parse', 'HEAD'])
      await git(workspaceRoot, ['tag', 'shared-v1.12.0'])
      await git(workspaceRoot, ['checkout', 'master'])
      await writeFile(join(workspaceRoot, 'feature.txt'), 'feature\n')
      await git(workspaceRoot, ['add', 'feature.txt'])
      await git(workspaceRoot, ['commit', '-m', 'feature'])
      await git(workspaceRoot, ['merge', '--no-ff', 'release', '-m', 'merge release'])

      const repository = new GitReleaseTagRepository(workspaceRoot)
      await expect(
        planSkippedReleaseTags(repository, [
          {
            packagePath: 'packages/shared',
            tagName: 'shared-v1.12.0',
            version: '1.12.0'
          }
        ])
      ).resolves.toEqual([])
      await expect(repository.resolveTag('shared-v1.12.0')).resolves.toBe(releaseSha)
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })
})
