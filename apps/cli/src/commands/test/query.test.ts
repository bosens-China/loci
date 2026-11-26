import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/shared'
import { beforeEach, expect, it } from 'vitest'
import { withRuntime } from '../../command-runtime.js'
import { cliFixture } from './fixture.js'

const cli = cliFixture()
let id: string
beforeEach(async () => {
  id = await withRuntime((r) => {
    const source = r.createSource({
      ...DOCUMENT_SOURCE_DEFAULTS,
      name: 'Alpha',
      url: 'https://alpha.test'
    })
    const other = r.createSource({
      ...DOCUMENT_SOURCE_DEFAULTS,
      name: 'Beta',
      url: 'https://beta.test'
    })
    r.createDocument(other.id, { path: '/guide/example', title: 'Beta', content: 'routing beta' })
    return source.id
  })
})

it('分页、可重复库过滤、关键词裁剪和多子树按序阅读共享结果', async () => {
  for (const [path, title, body] of [
    ['/guide/a', 'A', 'routing'],
    ['/guide/b', 'B', 'another'],
    ['/reference/hooks/c', 'C', 'navigation']
  ]) {
    await cli.json('doc', 'create', id, '--title', title, '--path', path, '--content', body)
  }
  expect(await cli.json('list', '--query', 'alp')).toMatchObject([{ id }])
  expect(await cli.json('list', '--offset', '1', '--limit', '1')).toHaveLength(1)
  const docs = await cli.json<{ id: string }[]>('list', id.slice(0, 7))
  expect(await cli.json('list', 'Alpha', '--offset', '1', '--limit', '1')).toEqual(docs.slice(1, 2))
  const args = [
    'search',
    'routing',
    'navigation',
    '--library',
    'Alpha,Beta',
    '--library',
    'Alpha',
    '--path-prefix',
    '/guide'
  ]
  expect(await cli.json(...args, '--limit', '1')).toMatchObject({
    total: 2,
    nextOffset: 1,
    hits: [{ sectionId: expect.any(String) }]
  })
  expect(await cli.json(...args, '--tree')).toMatchObject({
    total: 2,
    trees: expect.arrayContaining([{ libraryId: id, nodes: expect.any(Array) }])
  })
  const tree = await cli.json<{ children: { title: string }[] }[]>(
    'tree',
    'Alpha',
    '--query',
    'routing',
    'navigation',
    '--all'
  )
  expect(tree).toMatchObject([
    { title: 'guide', matchedCount: 1, totalCount: 2, children: [{ title: 'A' }] },
    { title: 'reference', children: [{ title: 'hooks', children: [{ title: 'C' }] }] }
  ])
  expect(await cli.json('tree', id, '--parent', '/reference', '--depth', '1')).toMatchObject([
    { title: 'hooks' }
  ])
  const pages = (
    await cli.text('read', '/reference', '/guide', '/guide/a', '--library', 'Alpha')
  ).split('\n---\n')
  expect(pages).toEqual([
    expect.stringMatching(
      /A[\s\S]*https:\/\/alpha\.test\/guide\/a[\s\S]*\/guide\/a[\s\S]*routing/u
    ),
    expect.stringMatching(
      /B[\s\S]*https:\/\/alpha\.test\/guide\/b[\s\S]*\/guide\/b[\s\S]*another/u
    ),
    expect.stringMatching(
      /C[\s\S]*https:\/\/alpha\.test\/reference\/hooks\/c[\s\S]*\/reference\/hooks\/c[\s\S]*navigation/u
    )
  ])
})

it('文档和小节 CRUD 更新 FTS、保留操作幂等，并约束删除范围', async () => {
  const path = join(cli.root(), 'content.md')
  writeFileSync(path, '# First\n\nold')
  const doc = await cli.json<{ id: string }>(
    'doc',
    'create',
    'Alpha',
    '--title',
    'First',
    '--path',
    '/guide/a',
    '--file',
    path,
    '--language',
    'en'
  )
  const ref = doc.id.slice(0, 8)
  await expect(cli.json('doc', 'update', ref, '--content', 'discarded')).rejects.toThrow('--yes')
  expect(
    await cli.json(
      'doc',
      'update',
      ref,
      '--library',
      id,
      '--title',
      'Second',
      '--content',
      '# Head\n\nnew',
      '--yes'
    )
  ).toMatchObject({ id: doc.id, title: 'Second' })
  await expect(
    cli.json('doc', 'update', ref, '--library', 'Beta', '--title', 'Wrong')
  ).rejects.toThrow()
  const args = [
    'doc',
    'section',
    ref,
    '--action',
    'add',
    '--heading',
    'Routing',
    '--level',
    '2',
    '--content',
    'router',
    '--operation-id',
    'add-one'
  ]
  await cli.json(...args)
  await cli.json(...args)
  const sections = await cli.json<{ id: string; title: string }[]>('doc', 'sections', ref)
  expect(sections.map((s) => s.title)).toEqual(['Head', 'Routing'])
  const sectionId = sections[1]!.id
  await cli.json(
    'doc',
    'section',
    ref,
    '--action',
    'update',
    '--section',
    sectionId,
    '--content',
    'needle',
    '--yes'
  )
  expect(await cli.json('search', 'needle')).toMatchObject({ hits: [{ id: doc.id, sectionId }] })
  const read = await cli.json<{ nextOffset: number; content: string }[]>(
    'read',
    ref,
    '--section',
    sectionId,
    '--max-chars',
    '4'
  )
  const tail = await cli.text(
    'read',
    ref,
    '--section',
    sectionId,
    '--offset',
    String(read[0]!.nextOffset)
  )
  expect(read[0]!.content + tail).toContain('needle')
  await expect(
    cli.json('doc', 'section', ref, '--action', 'delete', '--section', sectionId)
  ).rejects.toThrow('--yes')
  expect(await cli.json('search', 'needle')).toMatchObject({ total: 1 })
  await cli.json('doc', 'section', ref, '--action', 'delete', '--section', sectionId, '--yes')
  expect(await cli.json('search', 'needle')).toMatchObject({ total: 0 })
  await expect(cli.json('delete', 'Alpha', '--doc', '/guide')).rejects.toThrow('--yes')
  expect(await cli.json('delete', 'Alpha', '--doc', ref, '/guide', '--yes')).toMatchObject({
    deleted: 1
  })
  await cli.json('delete', 'Alpha', '--yes')
  expect(await cli.json('list')).toMatchObject([{ name: 'Beta' }])
})
