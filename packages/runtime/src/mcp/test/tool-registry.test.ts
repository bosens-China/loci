import { describe, expect, it } from 'vitest'
import { callLociMcpTool, LociToolNotFoundError } from '../tool-registry.js'
import { completedProgress, createServices, source } from './fixtures.js'
import type { UrlReviewSnapshot } from '../../url-review-database.js'

const reviewSnapshot: UrlReviewSnapshot = {
  run: {
    id: 'review-1',
    sourceId: source.id,
    goal: '只收录 API',
    status: 'awaiting_review',
    discovery: 'pages',
    fetchMode: 'http',
    firstUrl: source.url,
    iconUrl: null,
    limitReached: false,
    error: null
  },
  batchId: 'batch-1',
  candidates: [
    {
      id: 'candidate-1',
      runId: 'review-1',
      url: 'https://cn.vuejs.org/api/',
      title: 'API Reference',
      titleSource: 'link_text',
      decision: 'pending',
      batchId: 'batch-1',
      processed: false
    }
  ],
  discoveredCount: 1,
  approvedCount: 0,
  excludedCount: 0,
  processedCount: 0,
  failedCount: 0
}

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

  it('等待同步时逐页发送 SDK Progress，并向服务传递请求取消信号', async () => {
    const services = createServices()
    const controller = new AbortController()
    const messages: string[] = []
    const values: Array<[number, number]> = []
    services.crawlSource = async (_id, onProgress, signal) => {
      expect(signal).toBe(controller.signal)
      onProgress?.({
        ...completedProgress,
        queued: 2,
        node: {
          id: 'https://cn.vuejs.org/guide',
          url: 'https://cn.vuejs.org/guide',
          title: 'Guide',
          status: 'success'
        }
      })
      const final = {
        ...completedProgress,
        queued: 2,
        processed: 2,
        succeeded: 2,
        node: {
          id: 'https://cn.vuejs.org/api',
          url: 'https://cn.vuejs.org/api',
          title: 'API',
          status: 'success' as const
        }
      }
      onProgress?.(final)
      return final
    }

    await callLociMcpTool(
      services,
      'loci_sync_libraries',
      { library_ids: [source.id], wait_for_completion: true },
      {
        signal: controller.signal,
        progressToken: 'test',
        notifyProgress: async (progress, total, message) => {
          await Promise.resolve()
          values.push([progress, total])
          messages.push(message)
        }
      }
    )

    expect(values).toEqual([
      [1, 2],
      [2, 2]
    ])
    expect(messages).toEqual([
      expect.stringContaining('success Guide https://cn.vuejs.org/guide'),
      expect.stringContaining('success API https://cn.vuejs.org/api')
    ])
  })

  it('指定页面工具返回逐页 upsert 状态', async () => {
    const services = createServices()
    const controller = new AbortController()
    const messages: string[] = []
    services.fetchPages = async (_id, urls, onProgress, signal) => {
      expect(signal).toBe(controller.signal)
      onProgress?.({
        ...completedProgress,
        node: {
          id: urls[0] ?? '',
          url: urls[0] ?? '',
          title: 'New API',
          status: 'success'
        }
      })
      return {
        runId: 'run-1',
        items: urls.map((url) => ({ url, status: 'unchanged' as const })),
        progress: completedProgress
      }
    }
    const response = await callLociMcpTool(
      services,
      'loci_fetch_pages',
      {
        library_id: source.id,
        urls: ['https://cn.vuejs.org/api/new'],
        wait_for_completion: true
      },
      {
        signal: controller.signal,
        progressToken: 'test',
        notifyProgress: async (_progress, _total, message) => {
          messages.push(message)
        }
      }
    )

    expect(response.structuredContent).toMatchObject({
      library_id: source.id,
      sync_status: 'completed',
      items: [{ url: 'https://cn.vuejs.org/api/new', status: 'unchanged' }]
    })
    expect(messages).toEqual([
      expect.stringContaining('success New API https://cn.vuejs.org/api/new')
    ])
  })

  it('Agent 审查建库返回 title + url，并只接受显式批准剩余项', async () => {
    const services = createServices()
    const reviewedSource = {
      ...source,
      pages: 0,
      discoveryMode: 'agent_review' as const,
      reviewGoal: '只收录 API'
    }
    services.listSources = () => []
    services.createSource = () => reviewedSource
    services.startUrlReview = async () => reviewSnapshot
    services.submitUrlReview = async () => ({
      ...reviewSnapshot,
      run: { ...reviewSnapshot.run, status: 'completed' },
      candidates: []
    })

    const added = await callLociMcpTool(services, 'loci_add_library', {
      url: source.url,
      discovery_mode: 'agent_review',
      review_goal: '只收录 API'
    })
    expect(added.structuredContent).toMatchObject({
      sync_status: 'awaiting_review',
      url_review: {
        batch_id: 'batch-1',
        candidates: [{ title: 'API Reference', url: 'https://cn.vuejs.org/api/' }]
      }
    })

    await expect(
      callLociMcpTool(services, 'loci_submit_url_review', {
        run_id: 'review-1',
        batch_id: 'batch-1',
        exclude_urls: []
      })
    ).rejects.toThrow()
    const submitted = await callLociMcpTool(services, 'loci_submit_url_review', {
      run_id: 'review-1',
      batch_id: 'batch-1',
      exclude_urls: [],
      approve_remaining: true
    })
    expect(submitted.structuredContent).toMatchObject({ status: 'completed' })
  })

  it('中断的 URL 发现返回需恢复审查状态，而不是持续同步中', async () => {
    const services = createServices()
    services.getActiveUrlReview = () => ({
      ...reviewSnapshot,
      run: { ...reviewSnapshot.run, status: 'discovering' },
      batchId: undefined,
      candidates: []
    })

    const status = await callLociMcpTool(services, 'loci_get_sync_status', {
      library_ids: [source.id]
    })
    const sync = await callLociMcpTool(services, 'loci_sync_libraries', {
      library_ids: [source.id]
    })

    expect(status.structuredContent).toMatchObject({
      items: [{ library_id: source.id, sync_status: 'awaiting_review', run_id: 'review-1' }]
    })
    expect(sync.structuredContent).toMatchObject({
      items: [{ library_id: source.id, sync_status: 'awaiting_review', run_id: 'review-1' }]
    })
  })

  it('URL 审查与指定页面工具保留 MCP Cancellation', async () => {
    const abortError = new DOMException('request cancelled', 'AbortError')
    const services = createServices()
    services.startUrlReview = async () => {
      throw abortError
    }
    services.submitUrlReview = async () => {
      throw abortError
    }

    await expect(
      callLociMcpTool(services, 'loci_start_url_review', { library_id: source.id })
    ).rejects.toBe(abortError)
    await expect(
      callLociMcpTool(services, 'loci_submit_url_review', {
        run_id: 'review-1',
        batch_id: 'batch-1',
        exclude_urls: [],
        approve_remaining: true
      })
    ).rejects.toBe(abortError)

    const reviewedSource = {
      ...source,
      pages: 0,
      discoveryMode: 'agent_review' as const,
      reviewGoal: '只收录 API'
    }
    services.listSources = () => []
    services.createSource = () => reviewedSource
    await expect(
      callLociMcpTool(services, 'loci_add_library', {
        url: source.url,
        discovery_mode: 'agent_review',
        review_goal: '只收录 API'
      })
    ).rejects.toBe(abortError)

    services.createSource = () => source
    services.fetchPages = async () => {
      throw abortError
    }
    await expect(
      callLociMcpTool(services, 'loci_add_library', {
        url: source.url,
        discovery_mode: 'selected',
        wait_for_completion: true
      })
    ).rejects.toBe(abortError)
  })

  it('signal 已取消时抛出请求 reason，而不是普通失败结果', async () => {
    const services = createServices()
    const controller = new AbortController()
    const reason = new Error('transport cancelled')
    controller.abort(reason)
    services.startUrlReview = async () => {
      throw new Error('underlying request failed')
    }

    await expect(
      callLociMcpTool(
        services,
        'loci_start_url_review',
        { library_id: source.id },
        { signal: controller.signal }
      )
    ).rejects.toBe(reason)
  })
})
