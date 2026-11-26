import { expect, it } from 'vitest'
import { withRuntime } from '../../command-runtime.js'
import { cliFixture } from './fixture.js'

const cli = cliFixture()

it('分类 CLI 重试返回同一分类，删除后库及版本保留', async () => {
  const add = () => cli.json('category', 'add', ' 团队 ')
  const category = await add()
  expect(await add()).toEqual(category)
  await withRuntime((runtime) =>
    runtime.createSource({ url: 'https://test.example', category: '团队', version: 'latest' })
  )
  expect(await cli.json('category', 'list')).toContainEqual(
    expect.objectContaining({ name: '团队', libraryCount: 1 })
  )
  for (const deleted of [true, false]) {
    expect(await cli.json('category', 'delete', '团队', '--yes')).toEqual({ deleted })
  }
  expect(await cli.json('list')).toMatchObject([{ category: '未分类', version: 'latest' }])
})
