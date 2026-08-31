import {
  ArrowLeftOutlined,
  CaretRightOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ControlOutlined,
  GlobalOutlined,
  PauseOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { Breadcrumb, Button, Card, Tag, Tooltip, Typography } from 'antd'
import { ConfirmedActionButton } from '@/components/ConfirmedActionButton'
import { formatBytes } from '@/utils/format'
import type { DomainConcurrencySummary } from './job-state'

interface JobDomainHeaderProps {
  hostname: string
  totalCount: number
  activeCount: number
  pausedCount: number
  failedCount: number
  processed: number
  contentBytes: number
  configuredLimit: number
  concurrency: DomainConcurrencySummary
  pendingAction?: string
  onBack: () => void
  onOpenConcurrency: () => void
  onPause: () => void
  onResume: () => void
}

/** 域名任务详情头部，集中展示导航、状态摘要和域名级控制。 */
export function JobDomainHeader(props: JobDomainHeaderProps): React.JSX.Element {
  const concurrencyLabel = `${props.concurrency.totalUsed}/${props.configuredLimit} (${props.concurrency.utilizationPercent}%)`

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button icon={<ArrowLeftOutlined />} onClick={props.onBack}>
            返回域名大盘
          </Button>
          <Breadcrumb
            items={[
              {
                title: (
                  <Button type="link" className="h-auto! p-0!" onClick={props.onBack}>
                    任务中心
                  </Button>
                )
              },
              { title: <span className="font-mono font-semibold text-base">{props.hostname}</span> }
            ]}
          />
        </div>
      </div>

      <Card className="shadow-xs border-[var(--ant-color-border-secondary)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <GlobalOutlined className="text-[var(--ant-color-primary)] text-2xl" />
              <Typography.Title level={3} className="m-0! font-mono text-xl">
                {props.hostname}
              </Typography.Title>
              <DomainStatus activeCount={props.activeCount} failedCount={props.failedCount} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--ant-color-text-secondary)]">
              <span>共 {props.totalCount} 项任务记录</span>
              <span>·</span>
              <span>已处理 {props.processed} 页面</span>
              <span>·</span>
              <span>累计数据量 {formatBytes(props.contentBytes)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {props.activeCount > 0 ? (
              <Tooltip
                title={`实际并发占用: ${props.concurrency.totalUsed} / 并发上限: ${props.configuredLimit} (${props.concurrency.utilizationPercent}%)`}
              >
                <Tag
                  color={props.concurrency.utilizationPercent >= 100 ? 'success' : 'processing'}
                  className="m-0! cursor-pointer px-3 py-1.5 text-sm font-mono hover:opacity-80"
                  onClick={props.onOpenConcurrency}
                >
                  <ThunderboltOutlined /> 并发占用: {concurrencyLabel}
                </Tag>
              </Tooltip>
            ) : (
              <Tag
                className="m-0! cursor-pointer px-3 py-1.5 text-sm text-[var(--ant-color-text-tertiary)] hover:opacity-80"
                onClick={props.onOpenConcurrency}
              >
                并发空闲 (上限: {props.configuredLimit})
              </Tag>
            )}
            <Button icon={<ControlOutlined />} onClick={props.onOpenConcurrency}>
              限速与并发
            </Button>
            {props.activeCount > 0 && (
              <ConfirmedActionButton
                title={`暂停 ${props.hostname} 的全部活动任务？`}
                description="已经发出的页面请求会完成，后续批次将停止领取。"
                label="暂停此域名"
                icon={<PauseOutlined />}
                loading={props.pendingAction === `pause-all:${props.hostname}`}
                onConfirm={props.onPause}
              />
            )}
            {props.pausedCount > 0 && (
              <ConfirmedActionButton
                title={`恢复 ${props.hostname} 的全部暂停任务？`}
                description="任务将继续使用原任务 ID 和已保存的检查点。"
                label="恢复此域名"
                icon={<CaretRightOutlined />}
                loading={props.pendingAction === `resume-all:${props.hostname}`}
                onConfirm={props.onResume}
              />
            )}
          </div>
        </div>
      </Card>
    </>
  )
}

function DomainStatus(props: { activeCount: number; failedCount: number }): React.JSX.Element {
  if (props.activeCount > 0) {
    return (
      <Tag color="processing" className="m-0! flex items-center gap-1.5 px-3 py-1 text-sm">
        <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
        <span>{props.activeCount} 任务运行中</span>
      </Tag>
    )
  }
  if (props.failedCount > 0) {
    return (
      <Tag color="error" icon={<CloseCircleOutlined />} className="m-0! px-3 py-1 text-sm">
        存在失败任务
      </Tag>
    )
  }
  return (
    <Tag color="success" icon={<CheckCircleOutlined />} className="m-0! px-3 py-1 text-sm">
      全部任务就绪
    </Tag>
  )
}
