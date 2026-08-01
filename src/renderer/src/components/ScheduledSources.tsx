import { CalendarOutlined, EditOutlined, LinkOutlined } from '@ant-design/icons'
import { Avatar, Button, Card, Empty, Space, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { getNextScheduledRun } from '@shared/schedule'
import type { DocumentSource } from '../types'
import { SourceScheduleTag } from './SourceScheduleFields'

interface ScheduledSourcesProps {
  sources: DocumentSource[]
  onEdit: (source: DocumentSource) => void
  onShowSources: () => void
}

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function ScheduledSources({
  sources,
  onEdit,
  onShowSources
}: ScheduledSourcesProps): React.JSX.Element {
  if (sources.length === 0) {
    return (
      <Card>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有设置定时更新">
          <Button type="primary" onClick={onShowSources}>
            去文档源设置
          </Button>
        </Empty>
      </Card>
    )
  }

  const columns: TableProps<DocumentSource>['columns'] = [
    {
      title: '文档源',
      key: 'source',
      render: (_, source) => (
        <Space>
          <Avatar
            shape="square"
            src={source.iconUrl ?? undefined}
            icon={<LinkOutlined />}
            alt={`${source.name} 图标`}
          />
          <div className="min-w-0">
            <Typography.Text strong className="block">
              {source.name}
            </Typography.Text>
            <Typography.Text type="secondary" ellipsis className="block max-w-72 text-xs">
              {source.url}
            </Typography.Text>
          </div>
        </Space>
      )
    },
    {
      title: '执行计划',
      key: 'schedule',
      render: (_, source) => (
        <Space direction="vertical" size={2}>
          <SourceScheduleTag schedule={source.schedule} />
          <Typography.Text code className="text-xs">
            {source.schedule}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: '下次更新',
      key: 'nextRun',
      render: (_, source) => {
        const nextRun = getNextScheduledRun(source.schedule)
        return nextRun ? dateTimeFormatter.format(nextRun) : '计划无效'
      }
    },
    { title: '最近更新', dataIndex: 'lastUpdated', key: 'lastUpdated' },
    {
      title: '操作',
      key: 'actions',
      align: 'right',
      render: (_, source) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => onEdit(source)}>
          编辑计划
        </Button>
      )
    }
  ]

  return (
    <Card
      title={
        <Space>
          <CalendarOutlined /> 已设置 {sources.length} 个更新计划
        </Space>
      }
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={sources}
        pagination={false}
        scroll={{ x: 840 }}
      />
    </Card>
  )
}

export default ScheduledSources
