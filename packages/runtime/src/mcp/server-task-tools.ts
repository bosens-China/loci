import { formatLocalDate, type CloudSyncJob } from '@loci/shared'
import * as z from 'zod/v4'
import { failure, page, readAnnotations, result } from './server-support.js'
import type { LociMcpServices } from './services.js'
import type { LociToolRegistrar } from './tool-registry.js'

const statusSchema = z.enum([
  'queued',
  'running',
  'canceling',
  'canceled',
  'completed',
  'completed_with_errors',
  'failed'
])
const serverTaskSchema = z.object({
  id: z.string(),
  library_id: z.string(),
  hostname: z.string(),
  status: statusSchema,
  priority: z.number().int(),
  paused: z.boolean(),
  pause_requested: z.boolean(),
  stop_requested: z.boolean(),
  partial: z.boolean(),
  content_bytes: z.number().int().nonnegative(),
  remaining_count: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
  finished_at: z.string().nullable(),
  error: z.string().nullable(),
  progress: z
    .object({
      queued: z.number().int(),
      processed: z.number().int(),
      succeeded: z.number().int(),
      failed: z.number().int(),
      limit_reached: z.boolean()
    })
    .nullable()
})

/** Server 任务与本地任务分开命名，避免 Agent 把远端破坏性操作作用到本机。 */
export function registerServerTaskTools(
  register: LociToolRegistrar,
  services: LociMcpServices
): void {
  register(
    'loci_list_server_tasks',
    {
      title: '查看 Server 后台任务',
      description: '分页列出当前管理员 Server 的任务，可按 hostname、状态和批次日期筛选。',
      inputSchema: z.object({
        hostname: z.string().trim().min(1).optional(),
        status: statusSchema.optional(),
        date: z.iso.date().optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(20)
      }),
      outputSchema: z.object({
        total_count: z.number().int(),
        count: z.number().int(),
        offset: z.number().int(),
        items: z.array(serverTaskSchema),
        has_more: z.boolean(),
        next_offset: z.number().int().optional()
      }),
      annotations: readAnnotations()
    },
    async ({ hostname, status, date, offset, limit }) => {
      const normalized = hostname?.toLowerCase()
      const matches = (await services.listServerTasks()).filter(
        (task) =>
          (!normalized || task.hostname === normalized) &&
          (!status || task.status === status) &&
          (!date || formatLocalDate(task.createdAt) === date)
      )
      const items = matches.slice(offset, offset + limit).map(serializeServerTask)
      return result(
        page(items, matches.length, offset, limit),
        `找到 ${matches.length} 个 Server 任务`
      )
    }
  )

  register(
    'loci_control_server_task',
    {
      title: '控制一个 Server 后台任务',
      description:
        '暂停、恢复、结束、取消或调整 Server 任务。取消丢弃本次内容；结束保留已抓取内容和继续检查点。',
      inputSchema: z.object({
        task_id: z.string().min(1),
        action: z.enum(['pause', 'resume', 'stop', 'cancel', 'priority']),
        priority: z.number().int().min(-100).max(100).optional()
      }),
      outputSchema: z.object({ task: serverTaskSchema }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ task_id, action, priority }) => {
      if (action === 'priority' && priority === undefined) {
        return failure('调整优先级必须传 priority')
      }
      const task =
        action === 'priority'
          ? await services.setServerTaskPriority(task_id, priority!)
          : await services.controlServerTask(task_id, action)
      return result({ task: serializeServerTask(task) }, `Server 任务 ${task.id} 已执行 ${action}`)
    }
  )

  register(
    'loci_control_server_tasks',
    {
      title: '批量暂停或恢复 Server 后台任务',
      description: '暂停或恢复全部 Server 任务；传 hostname 时仅处理该域名。',
      inputSchema: z.object({
        action: z.enum(['pause', 'resume']),
        hostname: z.string().trim().min(1).optional()
      }),
      outputSchema: z.object({ changed: z.number().int().nonnegative() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ action, hostname }) => {
      const changed = await services.controlServerTasks(
        action === 'pause' ? 'pause-all' : 'resume-all',
        hostname?.toLowerCase()
      )
      return result(
        { changed },
        `已${action === 'pause' ? '暂停' : '恢复'} ${changed} 个 Server 任务`
      )
    }
  )
}

function serializeServerTask(task: CloudSyncJob): z.output<typeof serverTaskSchema> {
  return {
    id: task.id,
    library_id: task.libraryId,
    hostname: task.hostname,
    status: task.status,
    priority: task.priority,
    paused: task.paused,
    pause_requested: task.pauseRequested,
    stop_requested: task.stopRequested,
    partial: task.partial,
    content_bytes: task.contentBytes,
    remaining_count: task.remainingCount,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    finished_at: task.finishedAt,
    error: task.error,
    progress: task.progress
      ? {
          queued: task.progress.queued,
          processed: task.progress.processed,
          succeeded: task.progress.succeeded,
          failed: task.progress.failed,
          limit_reached: task.progress.limitReached
        }
      : null
  }
}
