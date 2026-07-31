import { ArrowRightOutlined, DatabaseOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography
} from 'antd'
import type { DocumentItem, DocumentSource } from '../types'

interface OverviewPageProps {
  sources: DocumentSource[]
  documents: DocumentItem[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onOpenSources: () => void
}

function OverviewPage({
  sources,
  documents,
  loading,
  error,
  onRetry,
  onOpenSources
}: OverviewPageProps): React.JSX.Element {
  if (loading && sources.length === 0 && documents.length === 0) {
    return <Skeleton active paragraph={{ rows: 8 }} />
  }

  if (!loading && !error && sources.length === 0) {
    return (
      <Empty description="添加第一个公开文档页面，开始建立本地知识库">
        <Button type="primary" icon={<DatabaseOutlined />} onClick={onOpenSources}>
          添加文档源
        </Button>
      </Empty>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <Typography.Title level={2}>知识库总览</Typography.Title>
          <Typography.Paragraph type="secondary">
            管理本地文档源，保持索引新鲜，随时查找答案。
          </Typography.Paragraph>
        </div>
        <Button type="primary" icon={<DatabaseOutlined />} onClick={onOpenSources}>
          管理文档源
        </Button>
      </div>

      {error && (
        <Alert
          className="mb-6"
          type="error"
          message={error}
          showIcon
          action={
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          }
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12}>
          <Card>
            <Statistic title="文档源" value={sources.length} suffix="个" />
            <Typography.Text type="secondary">
              {sources.length > 0 ? `覆盖 ${sources.length} 个站点` : '尚未添加文档源'}
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card>
            <Statistic title="已收录页面" value={documents.length.toLocaleString()} suffix="页" />
            <Typography.Text type="secondary">全部存储在本机</Typography.Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="mt-6">
        <Col xs={24} lg={16}>
          <Card
            title="文档源状态"
            extra={
              <Button type="link" onClick={onOpenSources}>
                查看全部 <ArrowRightOutlined />
              </Button>
            }
          >
            {sources.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有文档源" />
            ) : (
              <Space orientation="vertical" size={16} className="w-full">
                {sources.map((source) => (
                  <div key={source.id} className="flex items-center gap-4">
                    <DatabaseOutlined />
                    <div className="min-w-0 flex-1">
                      <Typography.Text strong>{source.name}</Typography.Text>
                      <Typography.Text ellipsis type="secondary" className="block">
                        {source.url}
                      </Typography.Text>
                    </div>
                    <div className="text-right">
                      <Typography.Text className="block">{source.pages} 页</Typography.Text>
                      <Typography.Text type="secondary" className="text-xs">
                        {source.lastUpdated}
                      </Typography.Text>
                    </div>
                    {source.status === 'healthy' && <Tag color="success">正常</Tag>}
                    {source.status === 'syncing' && <Tag color="processing">更新中</Tag>}
                    {source.status === 'attention' && <Tag color="warning">需检查</Tag>}
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="本地索引" className="h-full">
            <Statistic value={documents.length.toLocaleString()} suffix="页" />
            <Typography.Paragraph type="secondary" className="mb-0">
              更新文档源后，页面会自动加入全文检索和文档树。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default OverviewPage
