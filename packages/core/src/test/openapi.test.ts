import { describe, expect, it, vi } from 'vitest'
import {
  crawlOpenApiSource,
  discoverOpenApiEntries,
  isOpenApiDocument,
  looksLikeOpenApiDocumentationUrl
} from '../openapi.js'
import { projectOpenApiDocuments } from '../openapi-documents.js'
import { renderOpenApiMarkdown } from '../openapi-markdown.js'

function specification(title: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title, version: '0.1.0', description: '接口说明' },
    paths: {
      '/items/{id}': {
        get: {
          summary: '读取条目',
          description: '按 ID 返回条目',
          operationId: 'read_item',
          tags: ['条目管理', '内部接口'],
          security: [{ InternalSecret: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: '条目 ID'
            }
          ],
          responses: {
            200: {
              description: '成功',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Item' } }
              }
            }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        InternalSecret: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Internal-Secret',
          description: '内部接口调用密钥'
        }
      },
      schemas: {
        Item: {
          type: 'object',
          description: '条目模型',
          properties: { id: { type: 'string' } }
        }
      }
    }
  }
}

describe('OpenAPI 发现', () => {
  it.each([
    'https://api.example.com/docs',
    'https://api.example.com/redoc',
    'https://api.example.com/doc.html#/all',
    'https://api.example.com/swagger-ui/index.html',
    'https://api.example.com/v3/api-docs',
    'https://api.example.com/openapi.json'
  ])('识别常见阅读页 %s', (url) => {
    expect(looksLikeOpenApiDocumentationUrl(url)).toBe(true)
  })

  it('普通文档 URL 不发起候选探测', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(
      discoverOpenApiEntries('https://docs.example.com/guide/start', 'docs.example.com', {
        fetchImpl
      })
    ).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('GitHub Pages 不发起候选探测', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(
      discoverOpenApiEntries('https://owner.github.io/docs', 'owner.github.io', { fetchImpl })
    ).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('swagger-config 分组可用时不保存默认备用规范', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/v3/api-docs/swagger-config')) {
        return new Response(
          JSON.stringify({
            urls: [
              { name: 'Admin', url: '/v3/api-docs/admin' },
              { name: 'Public', url: '/v3/api-docs/public' }
            ]
          })
        )
      }
      if (url.endsWith('/v3/api-docs')) {
        return new Response(JSON.stringify(specification('Default API')))
      }
      if (url.endsWith('/v3/api-docs/admin')) {
        return new Response(JSON.stringify(specification('Grouped API')))
      }
      if (url.endsWith('/v3/api-docs/public')) {
        return new Response(JSON.stringify(specification('Grouped API')))
      }
      return new Response('<html>Swagger UI</html>')
    })

    const entries = await discoverOpenApiEntries(
      'https://api.example.com/doc.html#/all',
      'api.example.com',
      { fetchImpl }
    )

    expect(entries.map((entry) => entry.url)).toEqual([
      'https://api.example.com/v3/api-docs/admin',
      'https://api.example.com/v3/api-docs/public'
    ])
    expect(entries.map((entry) => entry.title)).toEqual([
      'Grouped API · Admin',
      'Grouped API · Public'
    ])
    expect(entries.map((entry) => entry.groupName)).toEqual(['Admin', 'Public'])
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/openapi.json',
      expect.objectContaining({ redirect: 'follow' })
    )
  })

  it('入口本身是 OpenAPI JSON 时只采用入口规范', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/v3/api-docs')) {
        return new Response(JSON.stringify(specification('Direct API')))
      }
      if (url.endsWith('/v3/api-docs/swagger-config')) {
        return new Response(JSON.stringify({ urls: [{ name: 'All', url: '/v3/api-docs/all' }] }))
      }
      if (url.endsWith('/v3/api-docs/all')) {
        return new Response(JSON.stringify(specification('Grouped API')))
      }
      return new Response('', { status: 404 })
    })

    const entries = await discoverOpenApiEntries(
      'https://api.example.com/v3/api-docs',
      'api.example.com',
      { fetchImpl }
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      url: 'https://api.example.com/v3/api-docs',
      title: 'Direct API'
    })
  })

  it('swagger-config 分组不可用时回退到默认规范', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/v3/api-docs/swagger-config')) {
        return new Response(JSON.stringify({ urls: [{ name: 'All', url: '/v3/api-docs/all' }] }))
      }
      if (url.endsWith('/v3/api-docs')) {
        return new Response(JSON.stringify(specification('Default API')))
      }
      return new Response('', { status: 404 })
    })

    const entries = await discoverOpenApiEntries(
      'https://api.example.com/doc.html',
      'api.example.com',
      { fetchImpl }
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      url: 'https://api.example.com/v3/api-docs',
      title: 'Default API'
    })
  })

  it('展开 Springfox swagger-resources 并识别 Swagger 2', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/swagger-resources')) {
        return new Response(
          JSON.stringify([
            { name: 'Default', location: '/v2/api-docs?group=default', swaggerVersion: '2.0' }
          ])
        )
      }
      if (url.endsWith('/v2/api-docs?group=default')) {
        return new Response(
          JSON.stringify({
            swagger: '2.0',
            info: { title: 'Legacy API', version: '1.0.0' },
            paths: {},
            definitions: { Item: { type: 'object' } }
          })
        )
      }
      return new Response('', { status: 404 })
    })

    const entries = await discoverOpenApiEntries(
      'https://api.example.com/doc.html',
      'api.example.com',
      { fetchImpl }
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      url: 'https://api.example.com/v2/api-docs?group=default',
      title: 'Legacy API · Default'
    })
    expect(isOpenApiDocument(entries[0]?.document)).toBe(true)
  })

  it('只把带规范标识、信息和路径的对象视为 OpenAPI', () => {
    expect(isOpenApiDocument(specification('API'))).toBe(true)
    expect(isOpenApiDocument({ openapi: '3.1.0', info: {}, paths: {} })).toBe(true)
    expect(isOpenApiDocument({ info: {}, paths: {} })).toBe(false)
    expect(isOpenApiDocument({ openapi: '3.1.0', paths: {} })).toBe(false)
  })
})

describe('OpenAPI Markdown', () => {
  it('整理接口、认证和数据模型', () => {
    const markdown = renderOpenApiMarkdown(specification('Ops API'))

    expect(markdown).toContain('# Ops API')
    expect(markdown).toContain('### InternalSecret')
    expect(markdown).toContain('### GET `/items/{id}` — 读取条目')
    expect(markdown).toContain('| id | path | 是 | string | 条目 ID |')
    expect(markdown).toContain('数据模型：`Item`')
    expect(markdown).toContain('### Item')
    expect(markdown).toContain('条目模型')
  })

  it('按分组、主标签和数据模型投影为多篇 Markdown', () => {
    const documents = projectOpenApiDocuments([
      {
        url: 'https://api.example.com/v3/api-docs/all',
        title: 'Ops API · all',
        groupName: 'all',
        document: specification('Ops API')
      }
    ])

    expect(documents.map((document) => document.relativePath)).toEqual([
      'all/index.md',
      'all/条目管理/read_item.md',
      'all/数据模型/Item.md'
    ])
    expect(documents[1]?.markdown).toContain('- 标签：`条目管理`、`内部接口`')
    expect(documents[1]?.markdown).toContain('数据模型：`Item`')
    expect(documents[2]?.markdown).toContain('# Item')
    expect(documents[1]?.url).toContain('#loci-openapi=all%2F%E6%9D%A1%E7%9B%AE')
  })

  it('通过完整快照交付派生文档并按文档数报告进度', async () => {
    const onSnapshot = vi.fn()
    const onDocument = vi.fn()
    const progress = await crawlOpenApiSource(
      {
        firstUrl: 'https://api.example.com/doc.html',
        hostname: 'api.example.com',
        pageLimit: 1,
        onDocument,
        onSnapshot
      },
      [
        {
          url: 'https://api.example.com/v3/api-docs/all',
          title: 'Ops API · all',
          groupName: 'all',
          document: specification('Ops API')
        }
      ]
    )

    expect(onSnapshot).toHaveBeenCalledOnce()
    expect(onSnapshot.mock.calls[0]?.[0]).toHaveLength(3)
    expect(onDocument).not.toHaveBeenCalled()
    expect(progress).toMatchObject({ queued: 3, processed: 3, succeeded: 3, failed: 0 })
  })

  it('逐篇生成大量派生文档并报告中间 checkpoint', async () => {
    const document = specification('Large API')
    document.paths = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [
        `/items/${index}`,
        { get: { summary: `读取条目 ${index}`, responses: { 200: { description: '成功' } } } }
      ])
    )
    const checkpoints: number[] = []
    let currentProcessed = 0
    const progress = await crawlOpenApiSource(
      {
        firstUrl: 'https://api.example.com/doc.html',
        hostname: 'api.example.com',
        pageLimit: 1,
        onDocument: vi.fn(),
        onSnapshot: vi.fn(),
        onProgress: (current) => {
          currentProcessed = current.processed
        },
        onCheckpoint: () => {
          checkpoints.push(currentProcessed)
        }
      },
      [
        {
          url: 'https://api.example.com/v3/api-docs/all',
          title: 'Large API',
          groupName: 'all',
          document
        }
      ]
    )

    expect(checkpoints).toEqual([10, 20, 27])
    expect(checkpoints.some((processed) => processed > 0 && processed < progress.queued)).toBe(true)
  })
})
