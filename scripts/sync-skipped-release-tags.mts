import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type JsonObject = Record<string, unknown>

export interface SkippedReleaseTag {
  packagePath: string
  tagName: string
  version: string
}

export interface PlannedReleaseTag extends SkippedReleaseTag {
  targetSha: string
}

export interface ReleaseTagRepository {
  listManifestCommits(): Promise<string[]>
  readManifestAt(commitSha: string): Promise<JsonObject>
  resolveTag(tagName: string): Promise<string | null>
  createTags(tags: PlannedReleaseTag[]): Promise<void>
}

function asObject(value: unknown, source: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} 必须是 JSON 对象`)
  }
  return value as JsonObject
}

function readRequiredString(value: unknown, source: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${source} 必须是非空字符串`)
  }
  return value
}

async function readJson(path: string): Promise<JsonObject> {
  return asObject(JSON.parse(await readFile(path, 'utf8')) as unknown, path)
}

function buildTagName(config: JsonObject, component: string, version: string): string {
  const separator = config['tag-separator'] ?? '-'
  if (typeof separator !== 'string') {
    throw new Error('tag-separator 必须是字符串')
  }
  const versionPrefix = config['include-v-in-tag'] === false ? '' : 'v'
  return `${component}${separator}${versionPrefix}${version}`
}

// skip-github-release 仍要求每个组件有 tag；这里只为私有 workspace 包补齐 tag。
export function findSkippedReleaseTags(
  configValue: unknown,
  manifestValue: unknown
): SkippedReleaseTag[] {
  const config = asObject(configValue, 'release-please-config.json')
  const manifest = asObject(manifestValue, '.release-please-manifest.json')
  const packages = asObject(config.packages, 'release-please-config.json#packages')
  const tags: SkippedReleaseTag[] = []

  for (const [packagePath, packageValue] of Object.entries(packages)) {
    const packageConfig = asObject(
      packageValue,
      `release-please-config.json#packages.${packagePath}`
    )
    if (packageConfig['skip-github-release'] !== true) continue

    const component = readRequiredString(packageConfig.component, `${packagePath}.component`)
    const version = readRequiredString(manifest[packagePath], `${packagePath} manifest version`)
    tags.push({
      packagePath,
      tagName: buildTagName(packageConfig, component, version),
      version
    })
  }

  return tags
}

async function findReleaseCommit(
  repository: ReleaseTagRepository,
  commits: readonly string[],
  tag: SkippedReleaseTag
): Promise<string> {
  let releaseCommit: string | null = null

  for (const commitSha of commits) {
    const manifest = await repository.readManifestAt(commitSha)
    if (manifest[tag.packagePath] === tag.version) {
      // manifest 历史从新到旧；保留同一版本连续区间的最早提交，避免后续其他包发布时移动标签。
      releaseCommit = commitSha
      continue
    }
    if (releaseCommit) return releaseCommit
  }

  if (releaseCommit) return releaseCommit
  throw new Error(`找不到 ${tag.packagePath} ${tag.version} 对应的 manifest 提交`)
}

export async function planSkippedReleaseTags(
  repository: ReleaseTagRepository,
  tags: readonly SkippedReleaseTag[]
): Promise<PlannedReleaseTag[]> {
  const commits = await repository.listManifestCommits()
  const planned: PlannedReleaseTag[] = []

  for (const tag of tags) {
    const targetSha = await findReleaseCommit(repository, commits, tag)
    const existingSha = await repository.resolveTag(tag.tagName)
    if (existingSha && existingSha !== targetSha) {
      throw new Error(`${tag.tagName} 已指向 ${existingSha}，预期为 ${targetSha}`)
    }
    if (!existingSha) planned.push({ ...tag, targetSha })
  }

  return planned
}

function isCommandError(error: unknown): error is { code?: number | string; stderr?: unknown } {
  return typeof error === 'object' && error !== null
}

export class GitReleaseTagRepository implements ReleaseTagRepository {
  private readonly workspaceRoot: string

  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: this.workspaceRoot })
    return stdout.trim()
  }

  async listManifestCommits(): Promise<string[]> {
    const output = await this.git([
      'log',
      '--first-parent',
      '--format=%H',
      '--',
      '.release-please-manifest.json'
    ])
    return output.length === 0 ? [] : output.split('\n')
  }

  async readManifestAt(commitSha: string): Promise<JsonObject> {
    const content = await this.git(['show', `${commitSha}:.release-please-manifest.json`])
    return asObject(JSON.parse(content) as unknown, `${commitSha}:.release-please-manifest.json`)
  }

  async resolveTag(tagName: string): Promise<string | null> {
    try {
      await this.git(['show-ref', '--verify', '--quiet', `refs/tags/${tagName}`])
    } catch (error) {
      if (isCommandError(error) && Number(error.code) === 1) return null
      throw error
    }
    return this.git(['rev-list', '-n', '1', tagName])
  }

  async createTags(tags: PlannedReleaseTag[]): Promise<void> {
    if (tags.length === 0) return

    for (const tag of tags) {
      await this.git(['tag', tag.tagName, tag.targetSha])
    }

    try {
      await this.git([
        'push',
        '--atomic',
        'origin',
        ...tags.map(({ tagName }) => `refs/tags/${tagName}`)
      ])
    } catch (error) {
      await Promise.all(tags.map(({ tagName }) => this.git(['tag', '--delete', tagName])))
      throw error
    }
  }
}

export async function syncSkippedReleaseTags(
  workspaceRoot = process.cwd(),
  repository: ReleaseTagRepository = new GitReleaseTagRepository(workspaceRoot)
): Promise<PlannedReleaseTag[]> {
  const config = await readJson(resolve(workspaceRoot, 'release-please-config.json'))
  const manifest = await readJson(resolve(workspaceRoot, '.release-please-manifest.json'))
  const planned = await planSkippedReleaseTags(repository, findSkippedReleaseTags(config, manifest))
  await repository.createTags(planned)
  return planned
}

const entryPath = process.argv[1]
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  const created = await syncSkippedReleaseTags()
  console.log(
    created.length === 0
      ? '私有 workspace release tag 已同步'
      : `已创建 release tag：${created.map(({ tagName }) => tagName).join(', ')}`
  )
}
