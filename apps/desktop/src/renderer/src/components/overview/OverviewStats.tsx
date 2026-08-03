import { ApiOutlined, DatabaseOutlined, FileTextOutlined, SyncOutlined } from '@ant-design/icons'
import { Card, Col, Row, Statistic, Tag, Tooltip, Typography } from 'antd'
import type { McpServerStatus } from '@shared/api'
import type { DocumentItem, DocumentSource } from '@renderer/types'

interface OverviewStatsProps {
  sources: DocumentSource[]
  documents: DocumentItem[]
  mcpStatus?: McpServerStatus
  mcpPort?: number
}

/**
 * 首页核心指标与 Agent MCP 状态卡片组件
 */
export function OverviewStats({
  sources,
  documents,
  mcpStatus,
  mcpPort = 37373
}: OverviewStatsProps): React.JSX.Element {
  const syncingSourcesCount = sources.filter((s) => s.status === 'syncing').length
  const scheduledCount = sources.filter((s) => Boolean(s.schedule)).length
  const isMcpRunning = mcpStatus?.running ?? true

  return (
    <Row gutter={[16, 16]} className="mb-6">
      <Col xs={24} sm={8}>
        <Card className="h-full border border-solid border-[var(--ant-color-border-secondary)] rounded-xl hover:shadow-sm transition-all">
          <div className="flex items-start justify-between">
            <div>
              <Typography.Text type="secondary" className="text-xs block mb-1">
                已收录文档源
              </Typography.Text>
              <Statistic
                value={sources.length}
                suffix={<span className="text-sm font-normal text-gray-500">个</span>}
                valueStyle={{ fontWeight: 600 }}
              />
            </div>
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-500 text-lg">
              <DatabaseOutlined />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-t-solid border-t-[var(--ant-color-border-secondary)] flex items-center justify-between text-xs text-gray-500">
            <span>自动调度: {scheduledCount} 个</span>
            {syncingSourcesCount > 0 && (
              <Tag color="processing" icon={<SyncOutlined spin />} className="m-0 text-xs">
                {syncingSourcesCount} 个更新中
              </Tag>
            )}
          </div>
        </Card>
      </Col>

      <Col xs={24} sm={8}>
        <Card className="h-full border border-solid border-[var(--ant-color-border-secondary)] rounded-xl hover:shadow-sm transition-all">
          <div className="flex items-start justify-between">
            <div>
              <Typography.Text type="secondary" className="text-xs block mb-1">
                本地索引页面
              </Typography.Text>
              <Statistic
                value={documents.length}
                groupSeparator=","
                suffix={<span className="text-sm font-normal text-gray-500">页</span>}
                valueStyle={{ fontWeight: 600 }}
              />
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-500 text-lg">
              <FileTextOutlined />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-t-solid border-t-[var(--ant-color-border-secondary)] text-xs text-gray-500">
            <span>FTS5 全文搜索与离线 Markdown 支持</span>
          </div>
        </Card>
      </Col>

      <Col xs={24} sm={8}>
        <Card className="h-full border border-solid border-[var(--ant-color-border-secondary)] rounded-xl hover:shadow-sm transition-all">
          <div className="flex items-start justify-between">
            <div>
              <Typography.Text type="secondary" className="text-xs block mb-1">
                Agent MCP 服务
              </Typography.Text>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${
                    isMcpRunning ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                  }`}
                />
                <Typography.Text strong className="text-base">
                  {isMcpRunning ? '服务运行中' : '服务停止'}
                </Typography.Text>
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-500 text-lg">
              <ApiOutlined />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-t-solid border-t-[var(--ant-color-border-secondary)] flex items-center justify-between text-xs text-gray-500">
            <Tooltip title={`MCP 节点 HTTP 监听端口: ${mcpPort}`}>
              <span className="font-mono bg-gray-500/10 px-1.5 py-0.5 rounded">
                127.0.0.1:{mcpPort}
              </span>
            </Tooltip>
            <span>8 个 MCP 工具就绪</span>
          </div>
        </Card>
      </Col>
    </Row>
  )
}
