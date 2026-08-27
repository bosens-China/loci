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
import { Button, Layout, Menu, Typography, type MenuProps } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from '@tanstack/react-router'
import { getAdminSession } from '@/api/admin'
import { ADMIN_SESSION_KEY } from '@/pages/admin/admin-query-keys'

const navigationItems = [
  { to: '/', label: '概览', icon: <HomeOutlined /> },
  { to: '/documents', label: '文档', icon: <FileTextOutlined /> },
  { to: '/cloud', label: '云端', icon: <CloudOutlined /> },
  { to: '/jobs', label: '任务', icon: <SyncOutlined /> },
  { to: '/logs', label: '日志', icon: <ProfileOutlined /> },
  { to: '/agents', label: 'Agent', icon: <RobotOutlined /> },
  { to: '/admin', label: '管理', icon: <SafetyCertificateOutlined /> },
  { to: '/settings', label: '设置', icon: <SettingOutlined /> }
] as const

const items: MenuProps['items'] = navigationItems.map((item) => ({
  key: item.to,
  icon: item.icon,
  label: <Link to={item.to}>{item.label}</Link>
}))

interface AppShellProps {
  children: React.ReactNode
}

/** 顶栏固定在视口顶部，窄屏通过横向导航保留全部入口。 */
export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const location = useLocation()
  const session = useQuery({
    queryKey: ADMIN_SESSION_KEY,
    queryFn: getAdminSession,
    staleTime: 30_000
  })
  return (
    <Layout className="min-h-screen min-w-0">
      <Layout.Header className="sticky top-0 z-50 flex h-auto min-h-16 items-center gap-4 px-4 sm:px-6">
        <Typography.Title
          level={3}
          className="m-0! shrink-0 text-[var(--ant-color-text-light-solid)]!"
        >
          Loci
        </Typography.Title>
        <nav aria-label="主导航" className="min-w-0 flex-1 overflow-x-auto">
          <Menu
            mode="horizontal"
            theme="dark"
            selectedKeys={[location.pathname]}
            items={items}
            className="min-w-max border-b-0!"
          />
        </nav>
        {session.data && (
          <Link to="/admin" title={`已登录 ${session.data.serverUrl}`}>
            <Button
              type="text"
              icon={<UserOutlined />}
              className="text-[var(--ant-color-text-light-solid)]!"
            >
              <span className="hidden max-w-28 truncate sm:inline">{session.data.username}</span>
            </Button>
          </Link>
        )}
      </Layout.Header>
      <Layout.Content className="min-h-0 flex-1">{children}</Layout.Content>
    </Layout>
  )
}
