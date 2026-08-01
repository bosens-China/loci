import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Space, Typography } from 'antd'

interface OverviewHeroProps {
  onAddSource: () => void
  onSearchClick: () => void
}

/**
 * 首页 Hero 顶部区域组件
 */
export function OverviewHero({ onAddSource, onSearchClick }: OverviewHeroProps): React.JSX.Element {
  return (
    <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-blue-500/10 via-purple-500/5 to-transparent border border-solid border-[var(--ant-color-border-secondary)]">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Typography.Title level={2} className="m-0! font-bold">
            知识库总览
          </Typography.Title>
        </div>
        <Typography.Paragraph type="secondary" className="m-0 text-sm">
          管理本地离线文档，维护高效索引，为 AI Agent 和人类提供秒级知识访问。
        </Typography.Paragraph>
      </div>

      <Space size="middle" className="shrink-0">
        <Button icon={<SearchOutlined />} onClick={onSearchClick}>
          检索知识库
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={onAddSource}>
          添加文档源
        </Button>
      </Space>
    </div>
  )
}
