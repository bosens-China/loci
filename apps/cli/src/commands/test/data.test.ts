import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/shared'
import { expect, it, vi } from 'vitest'
import { withRuntime } from '../../command-runtime.js'
import { cliFixture } from './fixture.js'

const cli = cliFixture()
it('备份恢复后保留库和 Markdown，非交互覆盖需确认', async () => {
  const path = join(cli.root(), 'backup.zip')
  await withRuntime((r) => {
    const source = r.createSource({
      ...DOCUMENT_SOURCE_DEFAULTS,
      name: 'Guide',
      url: 'https://docs.test'
    })
    r.createDocument(source.id, { path: '/guide', title: 'Guide', content: '# Guide' })
  })
  await withRuntime((r) => r.createSource({ url: 'https://other.test', name: 'Other' }))
  expect(
    await cli.json('data', 'export', path, '--category', '未分类', '--library', 'Guide')
  ).toMatchObject({ path })
  const bytes = await readFile(path)
  await expect(cli.json('data', 'export', path)).rejects.toThrow('--yes')
  expect(await readFile(path)).toEqual(bytes)
  await cli.json('data', 'export', path, '--category', '未分类', '--yes')
  vi.stubEnv('LOCI_DATA_DIR', join(cli.root(), 'new'))
  await expect(cli.json('data', 'import', path)).rejects.toThrow('--yes')
  await withRuntime((r) => r.createSource({ url: 'https://local.test', name: 'Local' }))
  expect(await cli.json('data', 'import', path, '--yes')).toMatchObject({
    mode: 'merge',
    documents: 1,
    sources: 2
  })
  expect(await cli.json('list')).toHaveLength(3)
  expect(await cli.json('data', 'import', path, '--replace-all', '--yes')).toMatchObject({
    mode: 'replace',
    replacedLibraries: 2
  })
  expect(await cli.json('list')).toHaveLength(2)
  expect(await cli.text('read', '/guide', '--library', 'Guide')).toBe('# Guide\n')
})

it('两种清库命令需要显式确认，按范围删除且可安全重试', async () => {
  const source = await withRuntime((r) => {
    const library = r.createSource({ url: 'https://clear.test', category: '备份资料' })
    r.createDocument(library.id, { path: '/guide', title: 'Guide', content: 'uniquetoken' })
    r.patchAppSettings({ theme: 'dark' })
    return library
  })
  await expect(cli.json('data', 'clear-documents')).rejects.toThrow('--yes')
  expect(await cli.json('search', 'uniquetoken')).toMatchObject({ total: 1 })
  expect(await cli.json('data', 'clear-documents', '--yes')).toEqual({
    scope: 'documents',
    libraries: 0,
    documents: 1
  })
  expect(await cli.json('list')).toMatchObject([
    { id: source.id, category: '备份资料', pageCount: 0 }
  ])
  expect(await cli.json('search', 'uniquetoken')).toMatchObject({ total: 0 })
  await expect(cli.json('data', 'clear-sources')).rejects.toThrow('--yes')
  expect(await cli.json('data', 'clear-sources', '--yes')).toEqual({
    scope: 'sources',
    libraries: 1,
    documents: 0
  })
  expect(await cli.json('data', 'clear-sources', '--yes')).toEqual({
    scope: 'sources',
    libraries: 0,
    documents: 0
  })
  expect(await cli.json('list')).toEqual([])
  expect(await cli.json('config')).toMatchObject({ theme: 'dark' })
})
