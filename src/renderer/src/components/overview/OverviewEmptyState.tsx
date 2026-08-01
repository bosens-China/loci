import { DatabaseOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Card, Col, Row, Typography } from 'antd'

interface OverviewEmptyStateProps {
  onAddSource: () => void
}

/**
 * 首页空状态引导面板组件
 */
export function OverviewEmptyState({ onAddSource }: OverviewEmptyStateProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 max-w-4xl mx-auto w-full">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-4 text-3xl">
          <DatabaseOutlined />
        </div>
        <Typography.Title level={2} className="m-0! font-bold">
          欢迎使用 Loci 本地知识库
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="mt-2 text-base max-w-xl mx-auto">
          添加公开技术文档链接，Loci 将自动解析并建立本地 Markdown 索引，供您和 AI Agent 高效检索。
        </Typography.Paragraph>
        <Button
          type="primary"
          size="large"
          icon={<PlusOutlined />}
          onClick={onAddSource}
          className="mt-2 shadow-md hover:shadow-lg transition-all"
        >
          添加第一个文档源
        </Button>
      </div>

      <Row gutter={[20, 20]} className="w-full">
        <Col xs={24} md={8}>
          <Card className="h-full border border-solid border-[var(--ant-color-border-secondary)] hover:border-primary/40 transition-all rounded-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/10 text-blue-500 font-bold">
                1
              </div>
              <Typography.Text strong className="text-base">
                添加文档源 URL
              </Typography.Text>
            </div>
            <Typography.Text type="secondary" className="text-sm block">
              输入任意公开文档页面链接，自动智能识别与抓取全站相关页面。
            </Typography.Text>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card className="h-full border border-solid border-[var(--ant-color-border-secondary)] hover:border-primary/40 transition-all rounded-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 font-bold">
                2
              </div>
              <Typography.Text strong className="text-base">
                本地格式化转换
              </Typography.Text>
            </div>
            <Typography.Text type="secondary" className="text-sm block">
              清洗无用标签并转换为标准的本地 Markdown，支持极速 FTS5 本地检索。
            </Typography.Text>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card className="h-full border border-solid border-[var(--ant-color-border-secondary)] hover:border-primary/40 transition-all rounded-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-500/10 text-purple-500 font-bold">
                3
              </div>
              <Typography.Text strong className="text-base">
                Agent 实时共享
              </Typography.Text>
            </div>
            <Typography.Text type="secondary" className="text-sm block">
              通过内建 MCP HTTP 服务（端口 37373）直接对接 Cursor/Claude/Gemini 等工具。
            </Typography.Text>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
