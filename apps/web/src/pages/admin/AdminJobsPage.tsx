import { useQuery } from '@tanstack/react-query'
import { listAdminJobs, listAdminLibraries } from '@/api/admin'
import { PageHeader } from '@/components/PageHeader'
import { AdminJobsPanel } from '@/pages/admin/AdminJobsPanel'
import { useAdminJobControls } from '@/pages/admin/use-admin-job-controls'
import { ADMIN_JOBS_KEY, ADMIN_LIBRARIES_KEY } from '@/pages/admin/admin-query-keys'
import { isAdminJobActive } from '@/pages/admin/admin-state'

/** Server 同步任务中心独立页面 */
export function AdminJobsPage(): React.JSX.Element {
  const jobControls = useAdminJobControls()

  const libraries = useQuery({
    queryKey: ADMIN_LIBRARIES_KEY,
    queryFn: listAdminLibraries,
    refetchInterval: 5_000
  })
  const jobs = useQuery({
    queryKey: ADMIN_JOBS_KEY,
    queryFn: listAdminJobs,
    refetchInterval: ({ state }) => (state.data?.some(isAdminJobActive) ? 1_000 : 5_000)
  })

  return (
    <>
      <PageHeader
        title="Server 任务中心"
        description="监控与调度远端 Loci Server 的后台抓取队列、并发速率与任务控制。"
      />

      <AdminJobsPanel
        query={jobs}
        libraries={libraries.data}
        onControl={jobControls.control}
        onPriority={jobControls.setPriority}
        onDomainControl={jobControls.controlDomain}
        pendingKey={jobControls.pendingKey}
      />
    </>
  )
}
