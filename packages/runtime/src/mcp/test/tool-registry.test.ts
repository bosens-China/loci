import { describe, expect, it } from 'vitest'
import { callLociMcpTool, LociToolNotFoundError } from '../tool-registry.js'
import { completedProgress, createServices, source } from './fixtures.js'

describe('Loci MCP 工具注册表', () => {
  it('可绕过传输层调用同一工具并应用输入默认值', async () => {
    const response = await callLociMcpTool(createServices(), 'loci_list_libraries', {})

    expect(response.isError).not.toBe(true)
    expect(response.structuredContent).toMatchObject({
      total_count: 1,
      count: 1,
      offset: 0,
      items: [{ id: source.id }]
    })
  })

  it('复用工具 Schema 拒绝无效输入', async () => {
    await expect(
      callLociMcpTool(createServices(), 'loci_get_library_tree', { depth: 8 })
    ).rejects.toThrow()
  })

  it('未知工具返回包含可用名称的明确错误', async () => {
    await expect(callLociMcpTool(createServices(), 'loci_unknown', {})).rejects.toEqual(
      expect.objectContaining<LociToolNotFoundError>({
        name: 'LociToolNotFoundError',
        message: expect.stringContaining('loci_list_libraries')
      })
    )
  })

  it('直调入口在返回前收口后台同步，避免短进程提前关闭资源', async () => {
    const services = createServices()
    let completed = false
    services.listSources = () => []
    services.crawlSource = async () => {
      await Promise.resolve()
      completed = true
      return completedProgress
    }

    const response = await callLociMcpTool(services, 'loci_add_library', {
      url: 'https://example.com/docs'
    })

    expect(completed).toBe(true)
    expect(response.structuredContent).toMatchObject({ sync_status: 'syncing' })
  })

  it('指定页面工具返回逐页 upsert 状态', async () => {
    const response = await callLociMcpTool(createServices(), 'loci_fetch_pages', {
      library_id: source.id,
      urls: ['https://cn.vuejs.org/api/new'],
      wait_for_completion: true
    })

    expect(response.structuredContent).toMatchObject({
      library_id: source.id,
      sync_status: 'completed',
      items: [{ url: 'https://cn.vuejs.org/api/new', status: 'unchanged' }]
    })
  })
})
