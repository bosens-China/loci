import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Alert, Button, Card, Empty, Skeleton } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { listAdminLibraries } from '@/api/admin'
import { PageHeader } from '@/components/PageHeader'
import { AdminPublishPanel } from '@/pages/admin/AdminPublishPanel'
import { ADMIN_LIBRARIES_KEY } from '@/pages/admin/admin-query-keys'
import { listSources } from '@/api/sources'
import { getSettings } from '@/api/settings'

/** 从已选本地库进入的发布交接页。 */
export function AdminPublishPage({ sourceId }: { sourceId?: string }): React.JSX.Element {
  const navigate = useNavigate()
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const libraries = useQuery({
    queryKey: ADMIN_LIBRARIES_KEY,
    queryFn: listAdminLibraries
  })
  const source = sources.data?.find((item) => item.id === sourceId)
  const returnToLocalLibraries = (): void => {
    void navigate({ to: '/documents' })
  }

  return (
    <>
      <PageHeader
        title="发布到 Server"
        description="将已选本地文档库交付为远端公开库；来源、目标和覆盖范围会在发布前明确展示。"
        action={
          <Button icon={<ArrowLeftOutlined />} onClick={returnToLocalLibraries}>
            返回本地文档库
          </Button>
        }
      />

      {sources.isLoading ? (
        <Card className="border-[var(--ant-color-border-secondary)] shadow-xs">
          <Skeleton active paragraph={{ rows: 5 }} />
        </Card>
      ) : sources.error ? (
        <Alert
          type="error"
          showIcon
          message="无法读取本地文档库"
          description={sources.error.message}
          action={
            <Button size="small" onClick={() => void sources.refetch()}>
              重试
            </Button>
          }
        />
      ) : !sourceId || !source || source.cloud || source.pages === 0 ? (
        <Card className="border-[var(--ant-color-border-secondary)] shadow-xs">
          <Empty
            description={
              !sourceId
                ? '请从一个本地文档库发起发布'
                : '该文档库不存在、不是本地库，或尚未包含可发布的正文'
            }
          >
            <Button type="primary" onClick={returnToLocalLibraries}>
              选择本地文档库
            </Button>
          </Empty>
        </Card>
      ) : (
        <AdminPublishPanel
          source={source}
          libraries={libraries.data ?? []}
          librariesLoading={libraries.isLoading}
          serverUrl={settings.data?.serverUrl ?? '当前已连接的 Server'}
          onOpenLibraries={() => void navigate({ to: '/admin/libraries' })}
        />
      )}
    </>
  )
}
