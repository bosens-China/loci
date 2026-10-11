import {
  ArrowLeftOutlined,
  CaretRightOutlined,
  GlobalOutlined,
  PauseOutlined
} from '@ant-design/icons'
import { Breadcrumb, Button, Card, Typography } from 'antd'
import { DomainStatus } from './DomainStatus'
import { ConfirmedActionButton } from '@/components/ConfirmedActionButton'
import { formatBytes } from '@/utils/format'

interface JobDomainHeaderProps {
  hostname: string
  totalCount: number
  activeCount: number
  pausedCount: number
  failedCount: number
  stoppedCount: number
  processed: number
  contentBytes: number
  pendingAction?: string
  onBack: () => void
  onPause: () => void
  onResume: () => void
}

/** 域名任务详情头部，集中展示导航、状态摘要和域名级控制。 */
export function JobDomainHeader(props: JobDomainHeaderProps): React.JSX.Element {
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
              <DomainStatus
                active={props.activeCount}
                paused={props.pausedCount}
                failed={props.failedCount}
                stopped={props.stoppedCount}
              />
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
            {props.activeCount > 0 && (
              <ConfirmedActionButton
                title={`暂停 ${props.hostname} 的全部活动任务？`}
                description="已经发出的页面请求会完成，后续页面将停止领取。"
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
