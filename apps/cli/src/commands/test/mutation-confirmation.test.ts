import { createServer } from 'node:http'
import { expect, it } from 'vitest'
import { withRuntime } from '../../command-runtime.js'
import { cliFixture } from './fixture.js'

const cli = cliFixture()

it('更新和复用已有库会在裁剪正文前要求确认', async () => {
  const server = createServer((_request, response) =>
    response.end('<main><h1>Guide</h1><p>guide content</p></main>')
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试监听失败')
  const origin = `http://127.0.0.1:${address.port}`
  const url = origin + '/guide'
  try {
    const source = await withRuntime((r) => {
      const library = r.createSource({ url, mode: 'http' })
      r.createDocument(library.id, { title: 'Outside', path: 'outside', content: 'outsidetoken' })
      r.createDocument(library.id, {
        title: 'Excluded',
        path: 'guide/private',
        content: 'excludedtoken'
      })
      return library
    })
    const update = ['update', source.id, '--scope', '/guide', '--pages', url, '--wait']
    await expect(cli.json(...update)).rejects.toThrow('--yes')
    expect(await cli.json('search', 'outsidetoken')).toMatchObject({ total: 1 })
    expect(await cli.json(...update, '--yes')).toMatchObject([{ status: 'completed' }])
    expect(await cli.json('search', 'outsidetoken')).toMatchObject({ total: 0 })

    const fetch = [
      'fetch',
      url,
      '--scope',
      '/guide',
      '--exclude',
      '^/guide/private$',
      '--pages',
      '--wait'
    ]
    await expect(cli.json(...fetch)).rejects.toThrow('--yes')
    expect(await cli.json('search', 'excludedtoken')).toMatchObject({ total: 1 })
    expect(await cli.json(...fetch, '--yes')).toMatchObject([{ status: 'completed' }])
    expect(await cli.json('search', 'excludedtoken')).toMatchObject({ total: 0 })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
