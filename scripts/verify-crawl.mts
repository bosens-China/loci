import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { crawlSource } from '../packages/core/src/source.ts'
import type { CrawledDocument } from '../packages/core/src/types.ts'

// 先运行 pnpm cli:build，再运行 pnpm exec tsx scripts/verify-crawl.mts；验证数据写入隔离目录。
const output = resolve('.loci-dev/crawl-verification')
await mkdir(output, { recursive: true })

async function verify(url: string, name: string) {
  const documents: CrawledDocument[] = []
  const requests: string[] = []
  const startedAt = new Date().toISOString()
  let lastReport = 0
  const result = await crawlSource({
    firstUrl: url,
    hostname: new URL(url).hostname,
    fetchMode: 'auto',
    pageLimit: 1000,
    scopePath: '/',
    fetch: (input, init) => {
      requests.push(String(input))
      return fetch(input, init)
    },
    onDocument: (document) => {
      documents.push(document)
    },
    onProgress: (progress) => {
      if (Date.now() - lastReport > 10000) {
        console.log(name, progress.processed, progress.succeeded, progress.failed)
        lastReport = Date.now()
      }
    }
  })
  await writeFile(resolve(output, `${name}-documents.json`), JSON.stringify(documents))
  assert.equal(result.progress.failed, 0, JSON.stringify(result.progress.failures))
  assert.equal(result.progress.limitReached, false, '默认页面上限截断了文档')
  assert.ok(documents.every((document) => document.markdown.trim().length > 0))
  return { startedAt, finishedAt: new Date().toISOString(), ...result, documents, requests }
}

const github = await verify('https://github.com/vuejs/docs', 'github')
assert.equal(github.resolution.discovery, 'github')
const revision = github.resolution.github!.revision
const treeResponse = await fetch(
  `https://api.github.com/repos/vuejs/docs/git/trees/${revision}?recursive=1`,
  {
    headers: { 'User-Agent': 'Loci-verification' },
    signal: AbortSignal.timeout(30000)
  }
)
assert.ok(treeResponse.ok, `GitHub tree HTTP ${treeResponse.status}`)
const tree = (await treeResponse.json()) as {
  truncated: boolean
  tree: { type: string; path: string }[]
}
assert.equal(tree.truncated, false, '独立树清单被截断')
const expectedGithub = tree.tree
  .filter((entry) => entry.type === 'blob' && /\.mdx?$/iu.test(entry.path))
  .map((entry) => entry.path)
  .sort()
assert.deepEqual(github.documents.map((document) => document.relativePath!).sort(), expectedGithub)

const manifestResponse = await fetch('https://react.dev/llms.txt', {
  signal: AbortSignal.timeout(30000)
})
assert.ok(manifestResponse.ok)
const manifest = await manifestResponse.text()
// 独立提取 React 清单列表项，避免用被测清单解析器生成验收答案。
const expectedReact = [
  ...new Set(
    [...manifest.matchAll(/^\s*-\s+\[[^\]]+\]\(([^)]+)\)/gmu)]
      .map((match) => new URL(match[1], 'https://react.dev/llms.txt'))
      .filter((url) => url.hostname === 'react.dev')
      .map((url) => {
        url.hash = ''
        return url.toString()
      })
  )
].sort()
assert.ok(expectedReact.length > 50, 'React 清单没有识别出足够文档')
const react = await verify('https://react.dev/', 'react')
assert.equal(react.resolution.discovery, 'llms')
assert.equal(react.resolution.fetchMode, 'http')
assert.deepEqual(react.documents.map((document) => document.url).sort(), expectedReact)
assert.ok(
  react.requests.every(
    (url) => url === 'https://react.dev/llms.txt' || expectedReact.includes(url)
  ),
  '命中清单后仍在发现其他页面'
)

const summary = (run: typeof github, expected: number) => ({
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  resolution: run.resolution,
  progress: run.progress,
  expected,
  saved: run.documents.length,
  requests: run.requests.length,
  missing: 0,
  extra: 0,
  empty: 0
})
const report = {
  github: summary(github, expectedGithub.length),
  react: summary(react, expectedReact.length)
}
const cliDataDir = resolve(output, `cli-${randomUUID()}`)
const cliEnv = {
  ...process.env,
  LOCI_DATA_DIR: cliDataDir,
  LOCI_CACHE_DIR: resolve(cliDataDir, 'cache')
}
const cli = (args: string[]) =>
  execFileSync(process.execPath, ['apps/cli/dist/index.js', ...args], {
    env: cliEnv,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024
  })
for (const [url, name] of [
  ['https://github.com/vuejs/docs', 'verify-github'],
  ['https://react.dev/', 'verify-react']
]) {
  cli(['source', 'add', url, '--name', name])
  console.log(`CLI 已完成：${name}`)
}
const libraries = JSON.parse(cli(['mcp', 'call', 'loci_list_libraries', '--input', '{}'])) as {
  items: { name: string; pages: number; resolved_discovery: string }[]
}
assert.equal(
  libraries.items.find((item) => item.name === 'verify-github')?.pages,
  expectedGithub.length
)
assert.equal(
  libraries.items.find((item) => item.name === 'verify-react')?.pages,
  expectedReact.length
)
Object.assign(report, { cli: { dataDir: cliDataDir, libraries: libraries.items } })
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
console.log(`验证报告：${resolve(output, 'report.json')}`)
