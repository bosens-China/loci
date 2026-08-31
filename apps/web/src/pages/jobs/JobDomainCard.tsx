import { useMemo, useState } from 'react'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ControlOutlined,
  GlobalOutlined,
  RightOutlined,
  ThunderboltOutlined,
  WarningOutlined
} from '@ant-design/icons'
import type { DocumentSource, HostnameCrawlPolicy } from '@loci/shared'
import { Button, Card, Progress, Space, Tag, Tooltip, Typography } from 'antd'
import { formatBytes } from '@/utils/format'
import { JobConcurrencyModal } from './JobConcurrencyModal'
import {
  calculateDomainConcurrency,
  isActiveJob,
  jobViewStatus,
  type HostnameJobGroup
} from './job-state'

interface JobDomainCardProps {
  group: HostnameJobGroup
  sources?: DocumentSource[]
  policies?: HostnameCrawlPolicy[]
  defaultHttpConcurrency: number
  defaultBrowserConcurrency: number
  onSelect: (hostname: string) => void
}

/** 域名概览卡片（一级大盘 Grid 项）：标准舒适字号与控件尺寸，点击下钻进入二级详情页。 */
export function JobDomainCard(props: JobDomainCardProps): React.JSX.Element {
  const {
    group,
    sources = [],
    policies = [],
    defaultHttpConcurrency,
    defaultBrowserConcurrency,
    onSelect
  } = props

  const [modalOpen, setModalOpen] = useState(false)

  const sourcesMap = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources])
  const policy = policies.find((p) => p.hostname === group.hostname)

  // 区分是否包含浏览器抓取任务，并确定配置上限
  const hasBrowserJobs = group.jobs.some((job) => sourcesMap.get(job.sourceId)?.mode === 'browser')
  const configuredLimit = hasBrowserJobs
    ? (policy?.browserConcurrency ?? defaultBrowserConcurrency)
    : (policy?.httpConcurrency ?? defaultHttpConcurrency)

  // 动态并发分配算法计算实际占用
  const activeJobs = group.jobs.filter(isActiveJob)
  const concurrencySummary = calculateDomainConcurrency(activeJobs, configuredLimit)

  const activeCount = group.active
  const failedCount = group.failed
  const completedCount = group.jobs.filter((j) => jobViewStatus(j) === 'completed').length

  const percent = group.queued
    ? Math.min(100, Math.round((group.processed / group.queued) * 100))
    : completedCount > 0
      ? 100
      : 0

  // 获取关联的文档来源名称列表
  const sourceNames = useMemo(() => {
    const names = new Set<string>()
    for (const job of group.jobs) {
      const src = sourcesMap.get(job.sourceId)
      if (src) names.add(src.name)
    }
    return [...names]
  }, [group.jobs, sourcesMap])

  return (
    <>
      <Card
        hoverable
        className="group relative flex flex-col justify-between overflow-hidden border-[var(--ant-color-border-secondary)] p-1 transition-all hover:border-[var(--ant-color-primary)] hover:shadow-md"
        onClick={() => onSelect(group.hostname)}
      >
        <div>
          {/* 卡片头部：域名与状态徽标 */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <GlobalOutlined className="text-[var(--ant-color-primary)] text-lg shrink-0" />
                <Typography.Text
                  strong
                  className="truncate font-mono text-base group-hover:text-[var(--ant-color-primary)] transition-colors"
                  title={group.hostname}
                >
                  {group.hostname}
                </Typography.Text>
              </div>

              {/* 关联文档库名称 */}
              {sourceNames.length > 0 && (
                <div
                  className="mt-1 truncate text-sm text-[var(--ant-color-text-secondary)]"
                  title={sourceNames.join('、')}
                >
                  关联: {sourceNames.join('、')}
                </div>
              )}
            </div>

            {/* 状态徽标 */}
            <div className="shrink-0">
              {activeCount > 0 ? (
                <Tag
                  color="processing"
                  className="m-0! flex items-center gap-1 px-2.5 py-0.5 text-sm"
                >
                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                  <span>{activeCount} 运行中</span>
                </Tag>
              ) : failedCount > 0 && completedCount === 0 ? (
                <Tag
                  color="error"
                  icon={<CloseCircleOutlined />}
                  className="m-0! px-2.5 py-0.5 text-sm font-normal"
                >
                  同步失败
                </Tag>
              ) : failedCount > 0 && completedCount > 0 ? (
                <Tag
                  color="warning"
                  icon={<WarningOutlined />}
                  className="m-0! px-2.5 py-0.5 text-sm font-normal"
                >
                  部分失败 ({failedCount})
                </Tag>
              ) : (
                <Tag
                  color="success"
                  icon={<CheckCircleOutlined />}
                  className="m-0! px-2.5 py-0.5 text-sm font-normal"
                >
                  全部就绪
                </Tag>
              )}
            </div>
          </div>

          {/* 卡片中部：并发占用胶囊与进度展示 */}
          <div className="mt-4 space-y-2.5 rounded-lg bg-[var(--ant-color-fill-quaternary)]/60 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--ant-color-text-secondary)]">并发占用状态</span>
              <Tooltip
                title={`实际并发占用: ${concurrencySummary.totalUsed} / 配置上限: ${configuredLimit} (${concurrencySummary.utilizationPercent}%)`}
              >
                <Tag
                  color={
                    concurrencySummary.utilizationPercent >= 100
                      ? 'success'
                      : concurrencySummary.totalUsed > 0
                        ? 'processing'
                        : 'default'
                  }
                  className="m-0! text-sm font-mono px-2.5 py-0.5"
                >
                  <ThunderboltOutlined /> {concurrencySummary.totalUsed} / {configuredLimit} (
                  {concurrencySummary.utilizationPercent}%)
                </Tag>
              </Tooltip>
            </div>

            {activeCount > 0 ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm text-[var(--ant-color-text-secondary)]">
                  <span>抓取进度</span>
                  <span className="font-mono font-medium">{percent}%</span>
                </div>
                <Progress
                  percent={percent}
                  size="small"
                  showInfo={false}
                  status="active"
                  className="m-0!"
                />
              </div>
            ) : (
              <div className="flex items-center justify-between text-sm text-[var(--ant-color-text-tertiary)]">
                <span>累计抓取体积</span>
                <span className="font-medium">{formatBytes(group.contentBytes)}</span>
              </div>
            )}
          </div>
        </div>

        {/* 卡片底部操作栏 */}
        <div className="mt-5 flex items-center justify-between border-t border-[var(--ant-color-border-secondary)] pt-3 text-sm">
          <div className="flex items-center gap-2 text-[var(--ant-color-text-secondary)]">
            <span>共 {group.jobs.length} 项任务</span>
            {failedCount > 0 && (
              <span className="text-[var(--ant-color-error)] font-medium">
                · {failedCount} 失败
              </span>
            )}
          </div>

          <Space size={8} className="items-center">
            <Button
              icon={<ControlOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                setModalOpen(true)
              }}
            >
              限速设置
            </Button>

            <Button
              type="primary"
              icon={<RightOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                onSelect(group.hostname)
              }}
            >
              查看详情
            </Button>
          </Space>
        </div>
      </Card>

      {/* 并发限速弹窗 */}
      {modalOpen && (
        <JobConcurrencyModal
          open
          hostname={group.hostname}
          initialMode={hasBrowserJobs ? 'browser' : 'http'}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
}
