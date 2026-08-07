import { open, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { throwIfAborted } from './abort.js'
import { formatGithubBytes, GithubLimitError } from './github-limits.js'
import type { GithubRepository } from './github-url.js'

const githubConnectTimeoutMs = 30_000
const githubIdleTimeoutMs = 60_000

export interface GithubRepositoryMetadata {
  defaultBranch: string
  revision: string
}

export interface DownloadedGithubArchive {
  path: string
  cleanup: () => Promise<void>
}

export async function readGithubRepositoryMetadata(
  repository: GithubRepository,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<GithubRepositoryMetadata> {
  const owner = encodeURIComponent(repository.owner)
  const repo = encodeURIComponent(repository.repo)
  const info = await requestGithubJson(
    `https://api.github.com/repos/${owner}/${repo}`,
    fetchImpl,
    signal
  )
  if (!isRecord(info) || info.private === true || typeof info.default_branch !== 'string') {
    throw new Error('只支持无需登录即可读取的公开 GitHub 仓库')
  }
  const defaultBranch = info.default_branch
  const branch = await requestGithubJson(
    `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(defaultBranch)}`,
    fetchImpl,
    signal
  )
  if (!isRecord(branch) || !isRecord(branch.commit) || typeof branch.commit.sha !== 'string') {
    throw new Error('无法解析 GitHub 默认分支的当前提交')
  }
  return { defaultBranch, revision: branch.commit.sha }
}

export async function downloadGithubArchive(
  repository: GithubRepository,
  revision: string,
  limitBytes: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<DownloadedGithubArchive> {
  const directory = await mkdtemp(join(tmpdir(), 'loci-github-'))
  const archivePath = join(directory, 'repository.zip')
  try {
    await downloadToFile(repository, revision, archivePath, limitBytes, fetchImpl, signal)
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return {
    path: archivePath,
    cleanup: () => rm(directory, { recursive: true, force: true })
  }
}

async function requestGithubJson(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await fetchWithTimeout(url, fetchImpl, {
    signal,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Loci'
    }
  })
  if (!response.ok) {
    const suffix =
      response.status === 404 ? '仓库不存在、不是公开仓库，或无权访问' : `HTTP ${response.status}`
    throw new Error(`读取 GitHub 仓库信息失败：${suffix}`)
  }
  return response.json()
}

async function downloadToFile(
  repository: GithubRepository,
  revision: string,
  archivePath: string,
  limitBytes: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal)
  const owner = encodeURIComponent(repository.owner)
  const repo = encodeURIComponent(repository.repo)
  const url = `https://codeload.github.com/${owner}/${repo}/zip/${encodeURIComponent(revision)}`
  const controller = new AbortController()
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const response = await fetchWithTimeout(url, fetchImpl, { signal: combinedSignal })
  if (!response.ok || !response.body)
    throw new Error(`下载 GitHub ZIP 失败：HTTP ${response.status}`)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    await response.body.cancel()
    throw archiveLimitError(revision, limitBytes)
  }

  const file = await open(archivePath, 'wx')
  let downloaded = 0
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const resetIdleTimer = (): void => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(
      () => controller.abort(new Error('GitHub ZIP 下载连续 60 秒没有数据')),
      githubIdleTimeoutMs
    )
  }
  try {
    resetIdleTimer()
    const reader = response.body.getReader()
    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      resetIdleTimer()
      const buffer = Buffer.from(value)
      downloaded += buffer.byteLength
      if (downloaded > limitBytes) {
        controller.abort()
        throw archiveLimitError(revision, limitBytes)
      }
      await file.write(buffer)
    }
  } finally {
    clearTimeout(idleTimer)
    await file.close()
  }
}

function archiveLimitError(revision: string, limitBytes: number): GithubLimitError {
  return new GithubLimitError(
    `GitHub ZIP 下载超过 ${formatGithubBytes(limitBytes)} 上限`,
    revision,
    'archive',
    limitBytes
  )
}

async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  init: RequestInit
): Promise<Response> {
  const timeout = AbortSignal.timeout(githubConnectTimeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetchImpl(url, { ...init, signal })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
