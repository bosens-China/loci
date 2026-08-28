import { useQuery } from '@tanstack/react-query'
import { listAdminLibraries } from '@/api/admin'
import { PageHeader } from '@/components/PageHeader'
import { AdminPublishPanel } from '@/pages/admin/AdminPublishPanel'
import { ADMIN_LIBRARIES_KEY } from '@/pages/admin/admin-query-keys'

/** 发布本地库到云端独立页面 */
export function AdminPublishPage(): React.JSX.Element {
  const libraries = useQuery({
    queryKey: ADMIN_LIBRARIES_KEY,
    queryFn: listAdminLibraries,
    refetchInterval: 5_000
  })

  return (
    <>
      <PageHeader
        title="发布本地库到云端"
        description="将本机 SQLite 中的本地文档库推送到远端 Loci Server 进行公开分发。"
      />

      <AdminPublishPanel libraries={libraries.data ?? []} />
    </>
  )
}
