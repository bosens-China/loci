import { PageHeader } from '@/components/PageHeader'
import { AdminCrawlSettingsPanel } from './AdminCrawlSettingsPanel'

/** Server 只暴露跨域任务容量，页面执行策略交由共享底层。 */
export function AdminHostnamePoliciesPage(): React.JSX.Element {
  return (
    <>
      <PageHeader title="Server 任务策略" description="设置可以同时运行的不同域名任务数量。" />
      <AdminCrawlSettingsPanel />
    </>
  )
}
