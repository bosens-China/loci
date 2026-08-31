import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import * as yazl from 'yazl'
import { crawlGithubSource, type GithubSourceOptions } from '../github-source.js'
import { GithubLimitError } from '../github-limits.js'

const repository = {
  owner: 'vuejs',
  repo: 'docs',
  url: 'https://github.com/vuejs/docs',
  identity: 'github:vuejs/docs'
}

describe('crawlGithubSource', () => {
  it('streams a ZIP and preserves paths while rewriting Markdown links', async () => {
    const archive = await createZip({
      'docs-abc123/README.md': '# Home\n\n[Guide](guide/start.md)',
      'docs-abc123/guide/start.md': '# Start\n\n![Logo](../public/logo.png)',
      'docs-abc123/lfs.md': 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 42\n',
      'docs-abc123/public/logo.png': 'image'
    })
    const onProgress = vi.fn()
    const result = await crawlGithubSource({
      ...baseOptions(fetchSequence(archive)),
      onProgress
    })

    expect(result.revision).toBe('abc123')
    expect(result.defaultBranch).toBe('main')
    expect(result.documents.map((document) => document.relativePath)).toEqual([
      'README.md',
      'guide/start.md'
    ])
    expect(result.documents[0]?.title).toBe('README.md')
    expect(result.documents[0]?.markdown).toContain(
      'https://github.com/vuejs/docs/blob/abc123/guide/start.md'
    )
    expect(result.documents[1]?.markdown).toContain(
      'https://raw.githubusercontent.com/vuejs/docs/abc123/public/logo.png'
    )
    expect(result.progress).toMatchObject({ succeeded: 2, failed: 1, limitReached: false })
    expect(result.progress.failures?.[0]?.reason).toBe('git_lfs_unsupported')
    expect(onProgress).toHaveBeenCalled()
  })

  it('skips downloading an unchanged or already blocked revision', async () => {
    const unchangedFetch = fetchSequence(Buffer.alloc(0))
    const unchanged = await crawlGithubSource({
      ...baseOptions(unchangedFetch),
      previousRevision: 'abc123'
    })
    expect(unchanged.unchanged).toBe(true)
    expect(unchangedFetch).toHaveBeenCalledTimes(2)

    const blockedFetch = fetchSequence(Buffer.alloc(0))
    await expect(
      crawlGithubSource({
        ...baseOptions(blockedFetch),
        archiveLimitBytes: 10,
        blocked: { revision: 'abc123', kind: 'archive', limitBytes: 10 }
      })
    ).rejects.toBeInstanceOf(GithubLimitError)
    expect(blockedFetch).toHaveBeenCalledTimes(2)
  })

  it('includes MDX files without applying Markdown link rewriting', async () => {
    const mdx = '<Guide href="./next.mdx" />\n\n[Start](./start.mdx)\n'
    const archive = await createZip({
      'docs-abc123/README.MD': '# Home',
      'docs-abc123/guides/intro.MDX': mdx,
      'docs-abc123/src/component.tsx': 'export const Component = () => null'
    })

    const result = await crawlGithubSource(baseOptions(fetchSequence(archive)))

    expect(result.documents.map((document) => document.relativePath)).toEqual([
      'README.MD',
      'guides/intro.MDX'
    ])
    expect(result.documents[1]?.markdown).toBe(mdx)
  })

  it('rejects an archive from its declared download size before reading the body', async () => {
    const fetchImpl = fetchSequence(Buffer.from('large'), { 'content-length': '100' })
    await expect(
      crawlGithubSource({ ...baseOptions(fetchImpl), archiveLimitBytes: 10 })
    ).rejects.toMatchObject({ kind: 'archive', revision: 'abc123', limitBytes: 10 })
  })

  it('stops a GitHub download when the caller cancels', async () => {
    const controller = new AbortController()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ private: false, default_branch: 'main' }, { status: 200 })
      )
      .mockResolvedValueOnce(Response.json({ commit: { sha: 'abc123' } }, { status: 200 }))
      .mockImplementationOnce(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(stream) {
                stream.enqueue(new Uint8Array([1, 2, 3]))
                controller.abort(new Error('用户取消同步'))
              }
            })
          )
      )

    await expect(
      crawlGithubSource({
        ...baseOptions(fetchImpl),
        signal: controller.signal
      })
    ).rejects.toThrow('用户取消同步')
  })
})

function baseOptions(fetchImpl: typeof fetch): GithubSourceOptions {
  return { repository, pageLimit: 1000, fetch: fetchImpl }
}

function fetchSequence(archive: Buffer, headers?: HeadersInit): typeof fetch {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ private: false, default_branch: 'main' }, { status: 200 })
    )
    .mockResolvedValueOnce(Response.json({ commit: { sha: 'abc123' } }, { status: 200 }))
    .mockResolvedValueOnce(new Response(Uint8Array.from(archive).buffer, { status: 200, headers }))
}

function createZip(files: Record<string, string>): Promise<Buffer> {
  const archive = new yazl.ZipFile()
  for (const [path, content] of Object.entries(files)) archive.addBuffer(Buffer.from(content), path)
  archive.end()
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    archive.outputStream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    archive.outputStream.once('error', reject)
    archive.outputStream.once('end', () => resolve(Buffer.concat(chunks)))
  })
}
