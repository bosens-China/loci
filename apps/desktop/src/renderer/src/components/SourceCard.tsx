import {
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  FileSearchOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  LoadingOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { Avatar, Button, Card, Popconfirm, Space, Tag, Tooltip, Typography } from 'antd'
import { formatBytes } from '@loci/shared'
import { SourceScheduleTag } from './SourceScheduleFields'
import type { CrawlRunState, DocumentSource } from '../types'

interface SourceCardProps {
  source: DocumentSource
  crawlRun?: CrawlRunState
  onOpenLibrary: (sourceId: string) => void
  onCrawl: (source: DocumentSource) => void
  onOpenCrawlProgress: (sourceId: string) => void
  onEdit: (source: DocumentSource) => void
  onDelete: (id: string) => Promise<void>
}

function SourceCard({
  source,
  crawlRun,
  onOpenLibrary,
  onCrawl,
  onOpenCrawlProgress,
  onEdit,
  onDelete
}: SourceCardProps): React.JSX.Element {
  const running = crawlRun?.running ?? false
  const status = running
    ? 'syncing'
    : crawlRun?.error || crawlRun?.progress.failed
      ? 'attention'
      : source.status

  const hasHistoryRun = Boolean(crawlRun?.nodes && crawlRun.nodes.length > 0)
  const isNeverUpdated = !source.lastUpdated || source.lastUpdated === '尚未更新'

  return (
    <Card
      className={`h-full transition-all duration-200 ${
        running
          ? 'border-blue-400! shadow-blue-500/10 bg-blue-50/10 shadow-md dark:bg-blue-950/10'
          : 'hover:border-blue-400! hover:shadow-md'
      }`}
    >
      <div className="flex items-start gap-4">
        <Avatar
          shape="square"
          size={44}
          src={source.iconUrl ?? undefined}
          alt={`${source.name} 图标`}
          icon={<LinkOutlined />}
          className="shrink-0 rounded-lg bg-[var(--ant-color-fill-secondary)] text-lg"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <Typography.Link
              strong
              className="truncate text-base hover:text-blue-500"
              onClick={() => onOpenLibrary(source.id)}
            >
              {source.name}
            </Typography.Link>
            <Tag
              color={
                status === 'healthy' ? 'success' : status === 'syncing' ? 'processing' : 'warning'
              }
              icon={status === 'syncing' ? <LoadingOutlined spin /> : undefined}
              className={`m-0 shrink-0 ${hasHistoryRun ? 'cursor-pointer' : ''}`}
              onClick={() => {
                if (hasHistoryRun) onOpenCrawlProgress(source.id)
              }}
            >
              {status === 'healthy' ? '正常' : status === 'syncing' ? '更新中' : '需检查'}
            </Tag>
          </div>
          <Typography.Text ellipsis type="secondary" className="mt-0.5 block font-mono text-xs">
            {source.url}
          </Typography.Text>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Tag bordered={false} className="bg-[var(--ant-color-fill-quaternary)] text-xs">
              {source.mode === 'auto'
                ? '自动检测'
                : source.mode === 'http'
                  ? 'HTTP 直取'
                  : '浏览器渲染'}
            </Tag>
            <Tag bordered={false} className="bg-[var(--ant-color-fill-quaternary)] text-xs">
              {source.pages} 页
            </Tag>
            <Tag bordered={false} className="bg-[var(--ant-color-fill-quaternary)] text-xs">
              {formatBytes(source.contentSize)}
            </Tag>
            <Tag bordered={false} className="bg-[var(--ant-color-fill-quaternary)] text-xs">
              {source.httpConcurrency || source.browserConcurrency
                ? `HTTP ${source.httpConcurrency ?? '默认'} · 浏览器 ${source.browserConcurrency ?? '默认'}`
                : '默认并发'}
            </Tag>
            <SourceScheduleTag schedule={source.schedule} />
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-t-solid border-t-[var(--ant-color-border-secondary)] pt-3">
            <div className="flex items-center gap-1.5 text-xs text-[var(--ant-color-text-tertiary)]">
              <ClockCircleOutlined />
              <span>{isNeverUpdated ? '尚未同步更新' : `更新于 ${source.lastUpdated}`}</span>
            </div>
            <Space size={2}>
              <Tooltip title="在知识库中查看">
                <Button
                  type="text"
                  size="small"
                  icon={<FileSearchOutlined />}
                  aria-label="在知识库中查看文档源"
                  className="text-[var(--ant-color-text-secondary)] hover:text-blue-500"
                  onClick={() => onOpenLibrary(source.id)}
                />
              </Tooltip>
              {hasHistoryRun && !running && (
                <Tooltip title="查看抓取记录/报错">
                  <Button
                    type="text"
                    size="small"
                    icon={<InfoCircleOutlined />}
                    aria-label="查看抓取记录"
                    className="text-[var(--ant-color-text-secondary)] hover:text-blue-500"
                    onClick={() => onOpenCrawlProgress(source.id)}
                  />
                </Tooltip>
              )}
              <Tooltip title={running ? '查看抓取进度' : '更新文档源'}>
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined spin={running} />}
                  aria-label={running ? '查看抓取进度' : '更新文档源'}
                  className={
                    running
                      ? 'text-blue-500'
                      : 'text-[var(--ant-color-text-secondary)] hover:text-blue-500'
                  }
                  onClick={() => onCrawl(source)}
                />
              </Tooltip>
              <Tooltip title="编辑文档源">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  aria-label="编辑文档源"
                  disabled={running}
                  className="text-[var(--ant-color-text-secondary)] hover:text-blue-500"
                  onClick={() => onEdit(source)}
                />
              </Tooltip>
              <Popconfirm
                disabled={running}
                title="删除这个文档源？"
                description="已收录的页面也会从本地索引中移除。"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => onDelete(source.id)}
              >
                <Button
                  danger
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  aria-label="删除文档源"
                  disabled={running}
                />
              </Popconfirm>
            </Space>
          </div>
        </div>
      </div>
    </Card>
  )
}

export default SourceCard
