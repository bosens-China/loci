import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DOCUMENT_SOURCE_DEFAULTS } from '@loci/core'
import { createLocalMcpServices } from '../../local-mcp-services.js'
import { createLocalRuntime, type LocalRuntime } from '../../local-runtime.js'
import { acquireCrawlRuntimeLock } from '../../runtime-lock.js'
import { callLociMcpTool } from '../tool-registry.js'

describe('MCP 本地来源规划', () => {
  let directory = ''
  let runtime: LocalRuntime | undefined

  afterEach(async () => {
    await runtime?.close()
    if (directory) rmSync(directory, { recursive: true, force: true })
  })

  it('修改配置与跨入口同步共用文档源锁', async () => {
    directory = mkdtempSync(join(tmpdir(), 'loci-mcp-source-planning-'))
    runtime = createLocalRuntime({
      dataDir: join(directory, 'data'),
      cacheDir: join(directory, 'cache'),
      owner: 'MCP 测试'
    })
    const source = runtime.createSource({
      name: 'Vue',
      url: 'https://vuejs.org/guide/',
      ...DOCUMENT_SOURCE_DEFAULTS
    })
    const services = createLocalMcpServices(runtime)
    const external = acquireCrawlRuntimeLock(runtime.dataDir, source.id, '另一个入口')
    try {
      const blocked = await callLociMcpTool(services, 'loci_update_library', {
        library_id: source.id,
        page_limit: 2400
      })
      expect(blocked).toMatchObject({ isError: true })
      expect(blocked.content[0]).toMatchObject({
        type: 'text',
        text: '文档库正在同步，完成后才能修改配置'
      })
    } finally {
      external.release()
    }

    const response = await callLociMcpTool(services, 'loci_update_library', {
      library_id: source.id,
      page_limit: 2400
    })
    expect(response.structuredContent).toMatchObject({
      changed: true,
      library: { id: source.id, page_limit: 2400 }
    })
  })
})
