import type { ServerAdminAuditLog } from '@loci/shared'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, Empty, Table, Tag, Typography, type TableColumnsType } from 'antd'
import { listAdminAuditLogs } from '@/api/admin'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { formatDateTime } from '@/utils/format'

const DEFAULT_PAGE_SIZE = 20

/** Server 管理操作记录只展示脱敏请求摘要。 */
export function AdminAuditLogsPage(): React.JSX.Element {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const offset = (page - 1) * pageSize
  const logs = useQuery({
    queryKey: ['admin', 'audit-logs', offset, pageSize],
    queryFn: () => listAdminAuditLogs(offset, pageSize)
  })

  return (
    <>
      <PageHeader
        title="管理操作记录"
        description="查看 Server 认证后的管理写操作；请求正文、密码和 Token 不会保存。"
      />
      <AsyncState loading={logs.isLoading} error={logs.error} onRetry={() => void logs.refetch()}>
        <Card styles={{ body: { padding: 0 } }}>
          <Table<ServerAdminAuditLog>
            rowKey="id"
            dataSource={logs.data?.items}
            columns={columns}
            pagination={{
              current: page,
              pageSize,
              total: logs.data?.total ?? 0,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50', '100'],
              showTotal: (total) => `共 ${total} 条记录`,
              onChange: (nextPage, nextPageSize) => {
                setPage(nextPageSize === pageSize ? nextPage : 1)
                setPageSize(nextPageSize)
              }
            }}
            locale={{ emptyText: <Empty className="py-12" description="暂无管理操作记录" /> }}
          />
        </Card>
      </AsyncState>
    </>
  )
}

const columns: TableColumnsType<ServerAdminAuditLog> = [
  {
    title: '时间',
    dataIndex: 'createdAt',
    width: 180,
    render: (value: string) => formatDateTime(value)
  },
  { title: '管理员', dataIndex: 'actor', width: 140 },
  {
    title: '请求',
    width: 100,
    render: (_, item) => <Tag color={methodColors[item.method]}>{item.method}</Tag>
  },
  {
    title: '管理路径',
    dataIndex: 'path',
    render: (value: string) => <Typography.Text code>{value}</Typography.Text>
  },
  {
    title: '状态',
    dataIndex: 'statusCode',
    width: 90,
    render: (value: number) => <Tag color="success">{value}</Tag>
  }
]

const methodColors: Record<ServerAdminAuditLog['method'], string> = {
  POST: 'processing',
  PUT: 'warning',
  DELETE: 'error'
}
