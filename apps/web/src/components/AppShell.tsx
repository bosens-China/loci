import { useMemo, useState } from 'react'
import {
  BookOutlined,
  DesktopOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RobotOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { Button, Layout, Menu, Space, Tag, Typography, type MenuProps } from 'antd'
import { Link, useLocation } from '@tanstack/react-router'
import { ActiveTaskIndicator } from '@/components/shell/ActiveTaskIndicator'
import { resolveActiveMenuKey } from '@/components/shell/navigation-utils'
import { ShellLayoutContext } from '@/components/shell/ShellLayoutContext'
import { ThemeSwitcher } from '@/components/shell/ThemeSwitcher'
import { UpdateIndicator } from '@/components/shell/UpdateIndicator'

interface AppShellProps {
  children: React.ReactNode
}

/** 4 个核心快捷管理页面的主导航项 */
const navMenuItems: MenuProps['items'] = [
  {
    key: '/documents',
    icon: <BookOutlined />,
    label: <Link to="/documents">知识管理</Link>
  },
  {
    key: '/agents',
    icon: <RobotOutlined />,
    label: <Link to="/agents">Agent 接入</Link>
  },
  {
    key: '/browser',
    icon: <DesktopOutlined />,
    label: <Link to="/browser">无头浏览器</Link>
  },
  {
    key: '/settings',
    icon: <SettingOutlined />,
    label: <Link to="/settings">设置与数据</Link>
  }
]

/** 本机快捷管理面板主布局：侧边栏 + 顶栏 + 响应式内容区域 */
export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [rawLayout, setRawLayout] = useState(false)
  const activeKey = resolveActiveMenuKey(location.pathname)

  const menuItems = useMemo(() => navMenuItems, [])

  return (
    <ShellLayoutContext.Provider value={{ rawLayout, setRawLayout }}>
      <Layout className="h-screen overflow-hidden">
        <Layout.Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={null}
          width={220}
          theme="light"
          className="h-full overflow-y-auto border-r border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] shadow-[2px_0_8px_0_rgba(0,0,0,0.05)] dark:shadow-[4px_0_24px_0_rgba(0,0,0,0.7),1px_0_0_0_rgba(255,255,255,0.05)] transition-all duration-200 shrink-0 z-20"
        >
          <div className="flex h-14 items-center gap-2.5 border-b border-[var(--ant-color-border-secondary)] px-4 overflow-hidden whitespace-nowrap shrink-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ant-color-primary)] text-base text-[var(--ant-color-text-light-solid)] shadow-sm dark:bg-blue-950/70 dark:text-blue-400 dark:border dark:border-blue-500/30">
              <BookOutlined />
            </div>
            <div
              className={`flex min-w-0 items-center gap-2 transition-all duration-200 ${
                collapsed ? 'max-w-0 opacity-0 pointer-events-none' : 'max-w-36 opacity-100'
              }`}
            >
              <Typography.Title level={4} className="m-0! tracking-tight text-base font-bold">
                Loci
              </Typography.Title>
              <Tag color="blue" className="m-0! text-[10px] scale-90 origin-left">
                本地面板
              </Tag>
            </div>
          </div>

          <Menu
            mode="inline"
            selectedKeys={[activeKey]}
            items={menuItems}
            className="border-r-0! py-2 bg-transparent!"
          />
        </Layout.Sider>

        <Layout className="h-full flex flex-col min-w-0 overflow-hidden">
          <Layout.Header className="shrink-0 flex h-14 items-center justify-between border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-4 sm:px-5 shadow-[0_2px_8px_0_rgba(0,0,0,0.05)] dark:shadow-[0_4px_24px_0_rgba(0,0,0,0.7),0_1px_0_0_rgba(255,255,255,0.05)] z-10">
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              className="flex h-8 w-8 items-center justify-center p-0 text-sm text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)]"
              aria-label="折叠侧边栏"
            />

            <Space size={12} className="items-center">
              <ActiveTaskIndicator />
              <UpdateIndicator />
              <div className="h-4 w-px bg-[var(--ant-color-border-secondary)]" />
              <ThemeSwitcher />
            </Space>
          </Layout.Header>

          {rawLayout ? (
            <Layout.Content className="min-h-0 flex-1 overflow-hidden bg-[var(--ant-color-bg-layout)]">
              {children}
            </Layout.Content>
          ) : (
            <Layout.Content className="min-h-0 flex-1 overflow-y-auto bg-[var(--ant-color-bg-layout)] p-4 sm:p-6">
              <div className="rounded-xl bg-[var(--ant-color-bg-container)] shadow-sm border border-[var(--ant-color-border-secondary)]">
                {children}
              </div>
            </Layout.Content>
          )}
        </Layout>
      </Layout>
    </ShellLayoutContext.Provider>
  )
}
