import {
  CloudOutlined,
  FileTextOutlined,
  HomeOutlined,
  ProfileOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SyncOutlined,
  UserOutlined
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { getAdminSession } from '@/api/admin'
import { ADMIN_SESSION_KEY } from '@/pages/admin/admin-query-keys'

const items = [
  { to: '/', label: '概览', icon: <HomeOutlined /> },
  { to: '/documents', label: '文档', icon: <FileTextOutlined /> },
  { to: '/cloud', label: '云端', icon: <CloudOutlined /> },
  { to: '/jobs', label: '任务', icon: <SyncOutlined /> },
  { to: '/logs', label: '日志', icon: <ProfileOutlined /> },
  { to: '/agents', label: 'Agent', icon: <RobotOutlined /> },
  { to: '/admin', label: '管理', icon: <SafetyCertificateOutlined /> },
  { to: '/settings', label: '设置', icon: <SettingOutlined /> }
] as const

interface AppShellProps {
  children: React.ReactNode
}

/** 顶栏固定在视口顶部，窄屏通过横向导航保留全部入口。 */
export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const session = useQuery({
    queryKey: ADMIN_SESSION_KEY,
    queryFn: getAdminSession,
    staleTime: 30_000
  })
  return (
    <div className="flex min-h-screen min-w-0 flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-50 flex h-13 shrink-0 items-center gap-4 border-b border-[#2a3537] bg-shell px-4 text-white shadow-sm sm:gap-8 sm:px-6">
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="font-serif text-xl font-600 tracking-tight">Loci</span>
          <span className="text-[10px] font-650 tracking-[.18em] text-[#8aa3a5] uppercase">
            本地文档
          </span>
        </div>
        <nav aria-label="主导航" className="min-w-0 flex flex-1 items-center gap-1 overflow-x-auto">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: true }}
              className="focus-ring flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-600 transition-colors"
              activeProps={{ className: 'bg-white/12 text-white' }}
              inactiveProps={{ className: 'text-[#b8cbcc] hover:bg-white/6 hover:text-white' }}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>
        {session.data && (
          <Link
            to="/admin"
            className="focus-ring flex shrink-0 items-center gap-2 rounded-lg border border-white/12 bg-white/7 px-2.5 py-1.5 text-xs text-[#d8e5e5] hover:bg-white/12"
            title={`已登录 ${session.data.serverUrl}`}
          >
            <UserOutlined />
            <span className="hidden max-w-28 truncate sm:inline">{session.data.username}</span>
          </Link>
        )}
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  )
}
