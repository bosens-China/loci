import { useQuery } from '@tanstack/react-query'
import { ControlOutlined, GlobalOutlined } from '@ant-design/icons'
import { Tabs } from 'antd'
import {
  deleteAdminHostnamePolicy,
  listAdminHostnamePolicies,
  listAdminLibraries,
  saveAdminHostnamePolicy
} from '@/api/admin'
import { PageHeader } from '@/components/PageHeader'
import { HostnamePolicyPanel } from '@/pages/settings/HostnamePolicyPanel'
import { ADMIN_LIBRARIES_KEY } from '@/pages/admin/admin-query-keys'
import { AdminCrawlSettingsPanel } from '@/pages/admin/AdminCrawlSettingsPanel'

/** Server 全局默认与 hostname 覆盖共用一个抓取策略入口。 */
export function AdminHostnamePoliciesPage(): React.JSX.Element {
  const libraries = useQuery({
    queryKey: ADMIN_LIBRARIES_KEY,
    queryFn: listAdminLibraries,
    refetchInterval: 5_000
  })

  return (
    <>
      <PageHeader
        title="Server 抓取策略"
        description="统一管理远端任务并发、任务内抓取默认值与 Hostname 覆盖。"
      />
      <Tabs
        items={[
          {
            key: 'global',
            label: (
              <span className="flex items-center gap-1.5">
                <GlobalOutlined />
                全局默认
              </span>
            ),
            children: <AdminCrawlSettingsPanel />
          },
          {
            key: 'hostname',
            label: (
              <span className="flex items-center gap-1.5">
                <ControlOutlined />
                域名覆盖
              </span>
            ),
            children: (
              <HostnamePolicyPanel
                queryKey={['admin', 'hostname-policies']}
                listPolicies={listAdminHostnamePolicies}
                savePolicy={saveAdminHostnamePolicy}
                deletePolicy={deleteAdminHostnamePolicy}
                hostnames={(libraries.data ?? []).map((library) => library.hostname)}
                title="Server 域名覆盖"
                className="mt-0"
              />
            )
          }
        ]}
      />
    </>
  )
}
