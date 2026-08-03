import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findReleaseVersionMismatches } from '../check-release-versions.mts'

const temporaryDirectories: string[] = []

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function createWorkspace(manifestVersion: string): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'loci-release-versions-'))
  temporaryDirectories.push(workspaceRoot)
  await mkdir(join(workspaceRoot, 'apps/desktop'), { recursive: true })
  await writeJson(join(workspaceRoot, 'release-please-config.json'), {
    packages: { 'apps/desktop': { 'release-type': 'node' } }
  })
  await writeJson(join(workspaceRoot, '.release-please-manifest.json'), {
    'apps/desktop': manifestVersion
  })
  await writeJson(join(workspaceRoot, 'apps/desktop/package.json'), {
    name: '@loci/desktop',
    version: '1.2.1'
  })
  return workspaceRoot
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('findReleaseVersionMismatches', () => {
  it('版本一致时返回空数组', async () => {
    const workspaceRoot = await createWorkspace('1.2.1')

    await expect(findReleaseVersionMismatches(workspaceRoot)).resolves.toEqual([])
  })

  it('返回 manifest 与包版本的差异', async () => {
    const workspaceRoot = await createWorkspace('1.2.0')

    await expect(findReleaseVersionMismatches(workspaceRoot)).resolves.toEqual([
      {
        packagePath: 'apps/desktop',
        manifestVersion: '1.2.0',
        packageVersion: '1.2.1'
      }
    ])
  })
})
