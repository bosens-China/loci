import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageJson {
  dependencies?: Record<string, string>
}

const serverDirectory = resolve(import.meta.dirname, '..')
const repositoryDirectory = resolve(serverDirectory, '../..')
const dockerfile = readFileSync(resolve(serverDirectory, 'Dockerfile'), 'utf8')
const packageJson = JSON.parse(
  readFileSync(resolve(serverDirectory, 'package.json'), 'utf8')
) as PackageJson
const lockfile = readFileSync(resolve(repositoryDirectory, 'pnpm-lock.yaml'), 'utf8')

function readDockerArgument(name: string): string {
  const value = dockerfile.match(new RegExp(`^ARG ${name}=(.+)$`, 'm'))?.[1]
  if (!value) throw new Error(`Dockerfile 缺少 ${name}`)
  return value
}

describe('Server Dockerfile', () => {
  it('固定的 Playwright 版本与 lockfile 完整性保持一致', () => {
    const version = packageJson.dependencies?.['playwright-core']
    expect(version).toBeTruthy()
    expect(readDockerArgument('PLAYWRIGHT_VERSION')).toBe(version)

    const integrity = lockfile.match(
      new RegExp(`^  playwright-core@${version}:\\n    resolution: \\{integrity: ([^}]+)\\}`, 'm')
    )?.[1]
    expect(integrity).toBeTruthy()
    expect(readDockerArgument('PLAYWRIGHT_INTEGRITY')).toBe(integrity)
  })

  it('最终运行时继承独立的 Playwright 浏览器阶段', () => {
    expect(dockerfile).toContain('FROM playwright-runtime')
    expect(dockerfile).not.toContain(
      'node /app/apps/server/node_modules/playwright-core/cli.js install'
    )
  })
})
