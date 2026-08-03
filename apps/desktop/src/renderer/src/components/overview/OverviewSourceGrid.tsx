import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  GlobalOutlined,
  RightOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { Button, Card, Empty, Progress, Space, Tag, Tooltip, Typography } from 'antd'
import type { DocumentSource } from '../../types'

interface OverviewSourceGridProps {
  sources: DocumentSource[]
  onOpenSources: () => void
  onSelectSource: (sourceId: string) => void
  onCrawlSource?: (sourceId: string) => void
}

/**
 * 首页文档源监控矩阵组件
 */
export function OverviewSourceGrid({
  sources,
  onOpenSources,
  onSelectSource,
  onCrawlSource
}: OverviewSourceGridProps): React.JSX.Element {
  if (sources.length === 0) {
    return (
      <Card title="文档源监控" className="mb-6 rounded-xl">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无文档源" />
      </Card>
    )
  }

  // 最多在首页网格中展示 6 个源，其余点击“查看全部”
  const displayedSources = sources.slice(0, 6)

  return (
    <Card
      className="mb-6 border border-solid border-[var(--ant-color-border-secondary)] rounded-xl"
      title={
        <div className="flex items-center gap-2">
          <span className="font-semibold text-base">文档源监控矩阵</span>
          <Typography.Text type="secondary" className="text-xs font-normal">
            ({sources.length})
          </Typography.Text>
        </div>
      }
      extra={
        <Button type="link" size="small" onClick={onOpenSources} className="p-0">
          管理全部 <ArrowRightOutlined />
        </Button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayedSources.map((source) => {
          const percent = Math.min(
            100,
            Math.round((source.pages / (source.pageLimit || 1000)) * 100)
          )

          return (
            <div
              key={source.id}
              className="p-4 rounded-xl border border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] hover:border-primary/50 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {source.iconUrl ? (
                      <img
                        src={source.iconUrl}
                        alt=""
                        className="w-5 h-5 rounded shrink-0 object-contain"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    ) : (
                      <GlobalOutlined className="text-gray-400 shrink-0 text-base" />
                    )}
                    <Typography.Text strong className="truncate text-sm" title={source.name}>
                      {source.name}
                    </Typography.Text>
                  </div>

                  {source.status === 'healthy' && (
                    <Tag color="success" className="m-0 shrink-0 text-xs">
                      正常
                    </Tag>
                  )}
                  {source.status === 'syncing' && (
                    <Tag
                      color="processing"
                      icon={<SyncOutlined spin />}
                      className="m-0 shrink-0 text-xs"
                    >
                      更新中
                    </Tag>
                  )}
                  {source.status === 'attention' && (
                    <Tag color="warning" className="m-0 shrink-0 text-xs">
                      需检查
                    </Tag>
                  )}
                </div>

                <Typography.Text
                  type="secondary"
                  className="text-xs font-mono block truncate mb-3"
                  title={source.url}
                >
                  {source.url}
                </Typography.Text>

                <div className="mb-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>收录进度 ({source.pages} 页)</span>
                    <span>上限 {source.pageLimit} 页</span>
                  </div>
                  <Progress
                    percent={percent}
                    size="small"
                    showInfo={false}
                    status={source.status === 'syncing' ? 'active' : 'normal'}
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-t-solid border-t-[var(--ant-color-border-secondary)] flex items-center justify-between text-xs">
                <Space size={4} className="text-gray-400">
                  <ClockCircleOutlined />
                  <span>{source.lastUpdated || '未更新'}</span>
                </Space>

                <Space size="small">
                  {onCrawlSource && (
                    <Tooltip title="手动抓取更新">
                      <Button
                        type="text"
                        size="small"
                        icon={<SyncOutlined spin={source.status === 'syncing'} />}
                        disabled={source.status === 'syncing'}
                        onClick={() => onCrawlSource(source.id)}
                      />
                    </Tooltip>
                  )}
                  <Button
                    type="link"
                    size="small"
                    className="p-0 text-xs flex items-center"
                    onClick={() => onSelectSource(source.id)}
                  >
                    去浏览 <RightOutlined className="text-[10px]" />
                  </Button>
                </Space>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
