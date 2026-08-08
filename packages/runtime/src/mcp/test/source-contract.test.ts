import type { Client } from '@modelcontextprotocol/client'
import { afterEach, describe, expect, it } from 'vitest'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/core'
import type { CreateSourceInput } from '@loci/shared'
import { startMcpHttpServer, type McpHttpServer } from '../http.js'
import { connect, createServices, source } from './http-fixtures.js'

describe('MCP source contract', () => {
  let httpServer: McpHttpServer | undefined
  let client: Client | undefined

  afterEach(async () => {
    await client?.close()
    await httpServer?.close()
  })

  it('省略参数时使用产品基础值，不读取其他入口偏好', async () => {
    let createdInput: CreateSourceInput | undefined
    httpServer = await startMcpHttpServer(0, {
      ...createServices(),
      listSources: () => [],
      createSource: (input) => {
        createdInput = input
        return { ...source, id: 'new-source', pages: 0 }
      }
    })
    client = await connect(httpServer)

    await client.callTool({
      name: 'loci_add_library',
      arguments: { url: 'https://docs.example.com/guide' }
    })

    expect(createdInput).toMatchObject(DOCUMENT_SOURCE_DEFAULTS)
  })
})
