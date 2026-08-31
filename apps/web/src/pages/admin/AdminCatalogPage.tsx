import type { CloudCatalogItem } from '@loci/shared'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Empty, Table, Typography, type TableColumnsType } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { listCloudCatalog } from '@/api/cloud'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { formatBytes, formatDateTime } from '@/utils/format'
import { PAGE_SIZE_OPTIONS } from '@/utils/pagination'

/** 公开目录在 Admin 中只读预览，避免混入本地拉取与删除动作。 */
export function AdminCatalogPage(): React.JSX.Element {
  const catalog = useQuery({ queryKey: ['cloud-catalog'], queryFn: listCloudCatalog })

  return (
    <>
      <PageHeader
        title="公开目录预览"
        description="以访问者视角检查当前 Server 已发布的只读文档库。"
        action={
          <Button
            icon={<ReloadOutlined />}
            loading={catalog.isFetching}
            onClick={() => void catalog.refetch()}
          >
            刷新目录
          </Button>
        }
      />
      <AsyncState
        loading={catalog.isLoading}
        error={catalog.error}
        onRetry={() => void catalog.refetch()}
      >
        <Card styles={{ body: { padding: 0 } }}>
          <Table<CloudCatalogItem>
            rowKey="id"
            dataSource={catalog.data}
            columns={columns}
            pagination={{
              defaultPageSize: 20,
              showSizeChanger: true,
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              showTotal: (total) => `共 ${total} 个公开库`
            }}
            locale={{ emptyText: <Empty className="py-12" description="当前没有已发布公开库" /> }}
          />
        </Card>
      </AsyncState>
    </>
  )
}

const columns: TableColumnsType<CloudCatalogItem> = [
  {
    title: '文档库',
    render: (_, item) => (
      <div>
        <Typography.Text strong className="block">
          {item.name}
        </Typography.Text>
        <Typography.Link href={item.url} target="_blank" rel="noreferrer" className="text-xs">
          {item.url}
        </Typography.Link>
      </div>
    )
  },
  { title: '页面数', dataIndex: 'pages', width: 100 },
  {
    title: '正文大小',
    dataIndex: 'contentSize',
    width: 120,
    render: (value: number) => formatBytes(value)
  },
  {
    title: '发布时间',
    dataIndex: 'publishedAt',
    width: 180,
    render: (value: string) => formatDateTime(value)
  }
]
