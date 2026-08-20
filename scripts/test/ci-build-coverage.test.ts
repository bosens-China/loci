import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageJson {
  scripts?: Record<string, string>
}

const repositoryDirectory = process.cwd()
const workflow = readFileSync(resolve(repositoryDirectory, '.github/workflows/ci.yml'), 'utf8')
const cliPackage = JSON.parse(
  readFileSync(resolve(repositoryDirectory, 'apps/cli/package.json'), 'utf8')
) as PackageJson

describe('CI build coverage', () => {
  it('由 CLI build 唯一覆盖 Web UI 生产构建', () => {
    expect(cliPackage.scripts?.build).toContain('pnpm --filter @loci/web build')
    expect(workflow).toContain('if: ${{ needs.changes.outputs.cli')
    expect(workflow).not.toContain('build-web:')
    expect(workflow).not.toContain('pnpm web:build')
  })
})
