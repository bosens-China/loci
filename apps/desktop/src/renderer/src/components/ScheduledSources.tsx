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
        <Space size="middle">
          <Avatar
            shape="square"
            size={36}
            src={source.iconUrl ?? undefined}
            icon={<LinkOutlined />}
            alt={`${source.name} 图标`}
            className="shrink-0 rounded bg-[var(--ant-color-fill-secondary)]"
          />
          <div className="min-w-0">
            <Typography.Text strong className="block text-sm">
              {source.name}
            </Typography.Text>
            <Typography.Text type="secondary" ellipsis className="block max-w-72 font-mono text-xs">
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
          <Typography.Text code className="font-mono text-xs">
            {source.schedule}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: '下次预估更新',
      key: 'nextRun',
      render: (_, source) => {
        const nextRun = getNextScheduledRun(source.schedule)
        return nextRun ? (
          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
            {dateTimeFormatter.format(nextRun)}
          </span>
        ) : (
          <Typography.Text type="secondary">计划无效</Typography.Text>
        )
      }
    },
    {
      title: '最近一次更新',
      dataIndex: 'lastUpdated',
      key: 'lastUpdated',
      render: (val: string) => <span className="text-xs text-gray-500">{val}</span>
    },
    {
      title: '操作',
      key: 'actions',
      align: 'right',
      render: (_, source) => (
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onEdit(source)}>
          修改计划
        </Button>
      )
    }
  ]

  return (
    <Card
      title={
        <Space className="text-base font-medium">
          <CalendarOutlined className="text-blue-500" /> 已设置 {sources.length} 个定时自动抓取任务
        </Space>
      }
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={sources}
        pagination={false}
        scroll={{ x: 840 }}
        size="middle"
      />
    </Card>
  )
}

export default ScheduledSources
