import { formatLocalDate, type LocalJob } from '@loci/shared'
import * as z from 'zod/v4'
import { failure, page, readAnnotations, result } from './server-support.js'
import type { LociMcpServices } from './services.js'
import type { LociToolRegistrar } from './tool-registry.js'

const statusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled'])
const taskSchema = z.object({
  id: z.string(),
  library_id: z.string(),
  hostname: z.string(),
  trigger: z.enum(['manual', 'background', 'schedule', 'ui', 'mcp']),
  status: statusSchema,
  priority: z.number().int(),
  paused: z.boolean(),
  pause_requested: z.boolean(),
  stop_requested: z.boolean(),
  partial: z.boolean(),
  content_bytes: z.number().int().nonnegative(),
  remaining_count: z.number().int().nonnegative(),
  attempt_count: z.number().int().nonnegative(),
  cancel_requested: z.boolean(),
  scheduled_at: z.string(),
  started_at: z.string().nullable(),
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
    .nullable(),
  created_at: z.string(),
  updated_at: z.string()
})

const listTasksOutputSchema = z.object({
  total_count: z.number().int(),
  count: z.number().int(),
  offset: z.number().int(),
  items: z.array(taskSchema),
  has_more: z.boolean(),
  next_offset: z.number().int().optional()
})

const controlTaskOutputSchema = z.object({ task: taskSchema })
const controlTasksOutputSchema = z.object({ changed: z.number().int().nonnegative() })

export function registerTaskTools(register: LociToolRegistrar, services: LociMcpServices): void {
  register(
    'loci_list_tasks',
    {
      title: '查看本地后台任务',
      description: '分页列出持久任务，可按 hostname、状态和批次日期筛选。',
      inputSchema: z.object({
        hostname: z.string().trim().min(1).optional(),
        status: statusSchema.optional(),
        date: z.iso.date().optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(20)
      }),
      outputSchema: listTasksOutputSchema,
      annotations: readAnnotations()
    },
    ({ hostname, status, date, offset, limit }) => {
      const normalizedHostname = hostname?.toLowerCase()
      const matches = services
        .listLocalJobs(500)
        .filter(
          (task) =>
            (!normalizedHostname || task.hostname === normalizedHostname) &&
            (!status || task.status === status) &&
            (!date || formatLocalDate(task.scheduledAt) === date)
        )
      const items = matches.slice(offset, offset + limit).map(serializeTask)
      return result(page(items, matches.length, offset, limit), `找到 ${matches.length} 个任务`)
    }
  )

  register(
    'loci_control_task',
    {
      title: '控制一个本地后台任务',
      description:
        '暂停、恢复、结束、取消或调整一个任务。恢复会复用任务 ID 和检查点；取消会丢弃本次内容，结束保留已抓取内容。',
      inputSchema: z.object({
        task_id: z.string().min(1),
        action: z.enum(['pause', 'resume', 'stop', 'cancel', 'priority']),
        priority: z.number().int().min(-100).max(100).optional()
      }),
      outputSchema: controlTaskOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    ({ task_id, action, priority }) => {
      if (action === 'priority' && priority === undefined)
        return failure('调整优先级必须传 priority')
      const task = controlTask(services, task_id, action, priority)
      if (!task) return failure('任务不存在')
      return result({ task: serializeTask(task) }, `任务 ${task.id} 已执行 ${action}`)
    }
  )

  register(
    'loci_control_tasks',
    {
      title: '批量暂停或恢复本地后台任务',
      description: '暂停或恢复全部活动任务；传 hostname 时只处理该域名。',
      inputSchema: z.object({
        action: z.enum(['pause', 'resume']),
        hostname: z.string().trim().min(1).optional()
      }),
      outputSchema: controlTasksOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    ({ action, hostname }) => {
      const normalized = hostname?.toLowerCase()
      const changed =
        action === 'pause'
          ? services.pauseLocalJobs(normalized)
          : services.resumeLocalJobs(normalized)
      return result({ changed }, `已${action === 'pause' ? '暂停' : '恢复'} ${changed} 个任务`)
    }
  )
}

function controlTask(
  services: LociMcpServices,
  id: string,
  action: 'pause' | 'resume' | 'stop' | 'cancel' | 'priority',
  priority?: number
): LocalJob | undefined {
  if (action === 'pause') return services.pauseLocalJob(id)
  if (action === 'resume') return services.resumeLocalJob(id)
  if (action === 'stop') return services.stopLocalJob(id)
  if (action === 'cancel') return services.cancelLocalJob(id)
  return services.setLocalJobPriority(id, priority!)
}

function serializeTask(task: LocalJob): z.output<typeof taskSchema> {
  return {
    id: task.id,
    library_id: task.sourceId,
    hostname: task.hostname,
    trigger: task.trigger,
    status: task.status,
    priority: task.priority,
    paused: task.paused,
    pause_requested: task.pauseRequested,
    stop_requested: task.stopRequested,
    partial: task.partial,
    content_bytes: task.contentBytes,
    remaining_count: task.remainingCount,
    attempt_count: task.attemptCount,
    cancel_requested: task.cancelRequested,
    scheduled_at: task.scheduledAt,
    started_at: task.startedAt,
    finished_at: task.finishedAt,
    error: task.error,
    progress: task.result
      ? {
          queued: task.result.queued,
          processed: task.result.processed,
          succeeded: task.result.succeeded,
          failed: task.result.failed,
          limit_reached: task.result.limitReached
        }
      : null,
    created_at: task.createdAt,
    updated_at: task.updatedAt
  }
}
