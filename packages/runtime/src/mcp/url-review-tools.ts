import * as z from 'zod/v4'
import type { UrlReviewSnapshot } from '../url-review-database.js'
import { rethrowRequestCancellation } from '../url-review-cancellation.js'
import { cancelUrlReviewOutputSchema, urlReviewOutputSchema } from './schemas.js'
import { failure, readAnnotations, result, writeAnnotations } from './server-support.js'
import type { LociMcpServices } from './services.js'
import type { LociToolRegistrar } from './tool-registry.js'

export function registerUrlReviewTools(
  register: LociToolRegistrar,
  services: LociMcpServices
): void {
  registerStartUrlReview(register, services)
  registerGetUrlReview(register, services)
  registerSubmitUrlReview(register, services)
  registerCancelUrlReview(register, services)
}

function registerStartUrlReview(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
    'loci_start_url_review',
    {
      title: '开始 Agent URL 审查同步',
      description:
        '为已启用 agent_review 的本地网页文档库开始或恢复一次 URL 审查同步。返回 title + url 候选清单；必须逐项思考后调用 loci_submit_url_review，只提交不要的 URL。',
      inputSchema: z
        .object({
          library_id: z.string().min(1),
          goal: z
            .string()
            .trim()
            .min(1)
            .max(2_000)
            .optional()
            .describe('覆盖文档库保存的本次收录目标')
        })
        .strict(),
      outputSchema: urlReviewOutputSchema,
      annotations: writeAnnotations(true)
    },
    async ({ library_id, goal }, context) => {
      try {
        const snapshot = await services.startUrlReview(library_id, goal, context.signal)
        return result(serializeUrlReview(snapshot), reviewSummary(snapshot))
      } catch (error) {
        rethrowRequestCancellation(error, context.signal)
        return failure(error instanceof Error ? error.message : '无法开始 URL 审查')
      }
    }
  )
}

function registerGetUrlReview(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
    'loci_get_url_review',
    {
      title: '查看 URL 审查状态',
      description: '读取可恢复的 URL 审查运行及当前待审批清单，不改变任何决定。',
      inputSchema: z.object({ run_id: z.string().min(1) }).strict(),
      outputSchema: urlReviewOutputSchema,
      annotations: readAnnotations()
    },
    ({ run_id }) => {
      const snapshot = services.getUrlReview(run_id)
      return snapshot
        ? result(serializeUrlReview(snapshot), reviewSummary(snapshot))
        : failure('URL 审查运行不存在')
    }
  )
}

function registerSubmitUrlReview(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
    'loci_submit_url_review',
    {
      title: '提交 URL 排除清单',
      description:
        '提交当前批次中不要抓取的 URL，并明确批准其余全部 URL。相同参数可安全重试；exclude_urls 之外的候选会被抓取，随后返回下一批或完成状态。',
      inputSchema: z
        .object({
          run_id: z.string().min(1),
          batch_id: z.string().min(1),
          exclude_urls: z.array(z.url()).max(50).default([]),
          approve_remaining: z
            .literal(true)
            .describe('必须显式为 true，表示批准清单中未排除的全部 URL')
        })
        .strict(),
      outputSchema: urlReviewOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ run_id, batch_id, exclude_urls }, context) => {
      try {
        const snapshot = await services.submitUrlReview(
          run_id,
          batch_id,
          exclude_urls,
          context.signal
        )
        return result(serializeUrlReview(snapshot), reviewSummary(snapshot))
      } catch (error) {
        rethrowRequestCancellation(error, context.signal)
        return failure(error instanceof Error ? error.message : 'URL 审查提交失败')
      }
    }
  )
}

function registerCancelUrlReview(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
    'loci_cancel_url_review',
    {
      title: '取消 URL 审查',
      description: '取消等待中或推进中的 URL 审查运行；已提交的文档库内容不会被回滚。',
      inputSchema: z.object({ run_id: z.string().min(1) }).strict(),
      outputSchema: cancelUrlReviewOutputSchema,
      annotations: writeAnnotations(true)
    },
    ({ run_id }) => {
      const cancelled = services.cancelUrlReview(run_id)
      return result(
        { run_id, cancelled },
        cancelled ? 'URL 审查已取消' : 'URL 审查不存在或已经结束'
      )
    }
  )
}

export function serializeUrlReview(snapshot: UrlReviewSnapshot): Record<string, unknown> {
  return {
    run_id: snapshot.run.id,
    library_id: snapshot.run.sourceId,
    status: snapshot.run.status,
    goal: snapshot.run.goal,
    ...(snapshot.batchId ? { batch_id: snapshot.batchId } : {}),
    candidates: snapshot.candidates.map((candidate) => ({
      title: candidate.title,
      url: candidate.url,
      title_source: candidate.titleSource,
      ...(candidate.discoveredFrom ? { discovered_from: candidate.discoveredFrom } : {})
    })),
    discovered_count: snapshot.discoveredCount,
    approved_count: snapshot.approvedCount,
    excluded_count: snapshot.excludedCount,
    processed_count: snapshot.processedCount,
    failed_count: snapshot.failedCount,
    limit_reached: snapshot.run.limitReached,
    ...(snapshot.run.error ? { error: snapshot.run.error } : {})
  }
}

function reviewSummary(snapshot: UrlReviewSnapshot): string {
  if (snapshot.run.status === 'awaiting_review') {
    return `等待审查 ${snapshot.candidates.length} 个 URL；只需提交不要的 URL，其余将被批准`
  }
  if (snapshot.run.status === 'completed') return 'URL 审查同步已完成'
  if (snapshot.run.status === 'cancelled') return 'URL 审查已取消'
  if (snapshot.run.status === 'failed') return `URL 审查失败：${snapshot.run.error ?? '未知错误'}`
  return 'URL 审查正在发现候选页面'
}
