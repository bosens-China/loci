import { useMemo, useState } from 'react'
import {
  CaretRightOutlined,
  CheckCircleOutlined,
  PauseOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type { LocalJob } from '@loci/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { App, Button, Card, Empty, Input, Progress, Segmented, Tag, Typography } from 'antd'
import { controlAllJobs, listJobs, JOBS_QUERY_KEY } from '@/api/jobs'
import { getSettings, listHostnameCrawlPolicies } from '@/api/settings'
import { listSources } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { ConfirmedActionButton } from '@/components/ConfirmedActionButton'
import { PageHeader } from '@/components/PageHeader'
import { formatBytes } from '@/utils/format'
import { JobDomainCard } from './jobs/JobDomainCard'
import { groupJobsByHostname } from './jobs/job-state'

type DomainFilter = 'all' | 'running' | 'failed' | 'completed'
const EMPTY_JOBS: LocalJob[] = []

/** 一级路由页面：任务中心域名概览大盘（/jobs） */
export function JobsPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { message } = App.useApp()

  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<DomainFilter>('all')

  const jobs = useQuery({
    queryKey: JOBS_QUERY_KEY,
    queryFn: listJobs,
    refetchInterval: 1500
  })

  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: listSources
  })

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings
  })

  const policies = useQuery({
    queryKey: ['settings', 'hostname-policies'],
    queryFn: listHostnameCrawlPolicies
  })

  const bulkControl = useMutation({
    mutationFn: ({ action }: { action: 'pause-all' | 'resume-all' }) => controlAllJobs(action),
    onSuccess: (result, { action }) => {
      void jobs.refetch()
      void message.success(
        action === 'pause-all'
          ? `已下发全部暂停指令，影响 ${result.changed} 个任务`
          : `已下发全部恢复指令，影响 ${result.changed} 个任务`
      )
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const allJobs = jobs.data ?? EMPTY_JOBS
  const totalCount = allJobs.length
  const activeCount = allJobs.filter((j) => ['pending', 'running'].includes(j.status)).length
  const runningCount = allJobs.filter((j) => j.status === 'running').length
  const pausedCount = allJobs.filter((j) => j.status === 'pending' && Boolean(j.paused)).length
  const completedCount = allJobs.filter((j) => j.status === 'completed').length
  const failedCount = allJobs.filter((j) => j.status === 'failed').length
  const overallPercent = totalCount ? Math.round((completedCount / totalCount) * 100) : 0
  const totalBytes = allJobs.reduce((acc, j) => acc + (j.contentBytes ?? 0), 0)
  const totalProcessedPages = allJobs.reduce((acc, j) => acc + (j.result?.processed ?? 0), 0)

  const defaultHttpConcurrency = settings.data?.httpConcurrency ?? 9
  const defaultBrowserConcurrency = settings.data?.browserConcurrency ?? 5

  const groups = useMemo(() => groupJobsByHostname(allJobs), [allJobs])
  const sourcesMap = useMemo(
    () => new Map((sources.data ?? []).map((s) => [s.id, s])),
    [sources.data]
  )

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return groups.filter((group) => {
      if (filter === 'running' && group.active === 0) return false
      if (filter === 'failed' && group.failed === 0) return false
      if (filter === 'completed' && (group.active > 0 || group.failed > 0)) return false

      if (!q) return true

      if (group.hostname.toLowerCase().includes(q)) return true
      return group.jobs.some((job) => sourcesMap.get(job.sourceId)?.name.toLowerCase().includes(q))
    })
  }, [filter, groups, searchQuery, sourcesMap])

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8 space-y-4">
      <PageHeader
        title="任务中心"
        description="按域名划分独立并发队列与限速策略；不同域名并行推进，点击域名卡片可查看任务详情。"
      />

      <AsyncState
        loading={jobs.isLoading || sources.isLoading}
        error={jobs.error ?? sources.error}
        onRetry={() => void Promise.all([jobs.refetch(), sources.refetch()])}
      >
        {/* 顶部全局指标监控看板 */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card size="small" className="shadow-xs border-[var(--ant-color-border-secondary)]">
            <div className="flex items-center justify-between">
              <Typography.Text type="secondary" className="text-sm">
                活跃任务
              </Typography.Text>
              {runningCount > 0 && (
                <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                  <span className="absolute h-2.5 w-2.5 rounded-full bg-emerald-400/40 animate-ping" />
                  <span className="relative h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_4px_rgba(16,185,129,0.5)]" />
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-[var(--ant-color-text)]">
                {runningCount}
              </span>
              <span className="text-sm text-[var(--ant-color-text-secondary)]">
                / {activeCount} 进行中与排队
              </span>
            </div>
            <div className="mt-1 text-xs text-[var(--ant-color-text-tertiary)]">
              {pausedCount > 0 ? `${pausedCount} 个任务已暂停` : '后台队列正常调度中'}
            </div>
          </Card>

          <Card size="small" className="shadow-xs border-[var(--ant-color-border-secondary)]">
            <Typography.Text type="secondary" className="text-sm">
              整体进度
            </Typography.Text>
            <div className="mt-1.5 flex items-baseline justify-between">
              <span className="text-2xl font-semibold text-[var(--ant-color-text)]">
                {overallPercent}%
              </span>
              <span className="text-sm text-[var(--ant-color-text-secondary)]">
                {completedCount} / {totalCount} 已完成
              </span>
            </div>
            <Progress
              percent={overallPercent}
              size="small"
              showInfo={false}
              status={failedCount > 0 ? 'exception' : runningCount > 0 ? 'active' : 'normal'}
              className="mt-2! mb-0!"
            />
          </Card>

          <Card size="small" className="shadow-xs border-[var(--ant-color-border-secondary)]">
            <Typography.Text type="secondary" className="text-sm">
              累计抓取数据量
            </Typography.Text>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-[var(--ant-color-text)]">
                {formatBytes(totalBytes)}
              </span>
              <span className="text-sm text-[var(--ant-color-text-secondary)]">正文体积</span>
            </div>
            <div className="mt-1 text-xs text-[var(--ant-color-text-tertiary)]">
              累计已处理 {totalProcessedPages} 页面
            </div>
          </Card>

          <Card
            size="small"
            className="shadow-xs border-[var(--ant-color-border-secondary)] flex flex-col justify-between"
          >
            <Typography.Text type="secondary" className="text-sm">
              全局任务控制
            </Typography.Text>
            <div className="mt-2 flex items-center gap-2">
              {activeCount > 0 && (
                <ConfirmedActionButton
                  title="暂停全部活动任务？"
                  description="已经发出的页面请求会完成，所有域名将在下一批次暂停。"
                  label="全部暂停"
                  icon={<PauseOutlined />}
                  loading={bulkControl.isPending}
                  onConfirm={() => bulkControl.mutate({ action: 'pause-all' })}
                />
              )}
              {pausedCount > 0 && (
                <ConfirmedActionButton
                  title="恢复全部暂停任务？"
                  description="任务会继续使用原任务 ID 和已保存的检查点。"
                  label="全部恢复"
                  icon={<CaretRightOutlined />}
                  loading={bulkControl.isPending}
                  onConfirm={() => bulkControl.mutate({ action: 'resume-all' })}
                />
              )}
              {totalCount > 0 && activeCount === 0 && pausedCount === 0 && (
                <Tag
                  color="success"
                  icon={<CheckCircleOutlined />}
                  className="m-0! px-3 py-1 text-sm"
                >
                  全部任务已就绪
                </Tag>
              )}
              {totalCount === 0 && (
                <span className="text-sm text-[var(--ant-color-text-tertiary)]">暂无活动任务</span>
              )}
            </div>
          </Card>
        </section>

        {/* 域名筛选与搜索工具栏 */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-3">
            <Segmented<DomainFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { label: `全部域名 (${groups.length})`, value: 'all' },
                {
                  label: `运行中 (${groups.filter((g) => g.active > 0).length})`,
                  value: 'running'
                },
                {
                  label: `存在异常 (${groups.filter((g) => g.failed > 0).length})`,
                  value: 'failed'
                },
                {
                  label: `全部就绪 (${groups.filter((g) => g.active === 0 && g.failed === 0).length})`,
                  value: 'completed'
                }
              ]}
            />
          </div>

          <div className="flex items-center gap-2">
            <Input
              allowClear
              prefix={<SearchOutlined className="text-[var(--ant-color-text-tertiary)]" />}
              placeholder="搜索域名或关联文档库"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64"
            />
            {(searchQuery || filter !== 'all') && (
              <Button
                onClick={() => {
                  setSearchQuery('')
                  setFilter('all')
                }}
              >
                重置
              </Button>
            )}
          </div>
        </div>

        {/* 域名卡片矩阵（响应式 Grid 布局） */}
        {filteredGroups.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredGroups.map((group) => (
              <JobDomainCard
                key={group.hostname}
                group={group}
                sources={sources.data}
                policies={policies.data}
                defaultHttpConcurrency={defaultHttpConcurrency}
                defaultBrowserConcurrency={defaultBrowserConcurrency}
                onSelect={(hostname) =>
                  void navigate({ to: '/jobs/$hostname', params: { hostname } })
                }
              />
            ))}
          </div>
        ) : (
          <Card className="py-16">
            <Empty description={groups.length ? '没有符合筛选条件的域名' : '当前暂无抓取任务'} />
          </Card>
        )}
      </AsyncState>
    </div>
  )
}
