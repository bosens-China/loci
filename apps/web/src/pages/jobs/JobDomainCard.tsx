import { useMemo } from 'react'
import { GlobalOutlined, RightOutlined } from '@ant-design/icons'
import type { DocumentSource } from '@loci/shared'
import { Button, Card, Progress, Space, Typography } from 'antd'
import { formatBytes } from '@/utils/format'
import { getDomainJobProgress, type HostnameJobGroup } from './job-state'
import { DomainStatus } from './DomainStatus'

interface JobDomainCardProps {
  group: HostnameJobGroup
  sources?: DocumentSource[]
  onSelect: (hostname: string) => void
}

/** 域名概览卡片（一级大盘 Grid 项）：标准舒适字号与控件尺寸，点击下钻进入二级详情页。 */
export function JobDomainCard(props: JobDomainCardProps): React.JSX.Element {
  const { group, sources = [], onSelect } = props
  const sourcesMap = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources])
  const activeCount = group.active
  const failedCount = group.failed

  const progress = getDomainJobProgress(group.jobs)
  const percent = progress?.kind === 'determinate' ? progress.percent : 0

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
              <DomainStatus {...group} />
            </div>
          </div>

          {/* 卡片中部：抓取进度展示 */}
          <div className="mt-4 space-y-2.5 rounded-lg bg-[var(--ant-color-fill-quaternary)]/60 p-3">
            {activeCount > 0 ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm text-[var(--ant-color-text-secondary)]">
                  <span>抓取进度</span>
                  <span className="font-mono font-medium">
                    {progress?.kind === 'indeterminate' ? '准备中' : `${percent}%`}
                  </span>
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
    </>
  )
}
