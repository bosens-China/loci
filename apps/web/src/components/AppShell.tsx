import { useMemo, useState } from 'react'
import {
  AuditOutlined,
  BookOutlined,
  CloudDownloadOutlined,
  ControlOutlined,
  DashboardOutlined,
  DesktopOutlined,
  EyeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProfileOutlined,
  RobotOutlined,
  SettingOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { Button, Layout, Menu, Space, Tag, Typography, type MenuProps } from 'antd'
import { Link, useLocation } from '@tanstack/react-router'
import { ActiveTaskIndicator } from '@/components/shell/ActiveTaskIndicator'
import { isCloudRoute, resolveActiveMenuKey } from '@/components/shell/navigation-utils'
import { ShellLayoutContext } from '@/components/shell/ShellLayoutContext'
import { UserAvatarDropdown } from '@/components/shell/UserAvatarDropdown'
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher'

interface AppShellProps {
  children: React.ReactNode
}

/** 经典中后台主布局：左侧可折叠分组侧边栏 + 顶部全局 Header + 独立工作区控制。 */
export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [rawLayout, setRawLayout] = useState(false)
  const isCloud = isCloudRoute(location.pathname)
  const activeKey = resolveActiveMenuKey(location.pathname)

  const rawMenuItems = isCloud ? cloudMenuItems : localMenuItems
  const menuItems = useMemo(() => {
    if (!collapsed) return rawMenuItems
    // 折叠状态下自动拍平菜单分组，只保留整齐对齐的图标，避免 80px 宽度下分组标题文字被挤压截断
    return (rawMenuItems ?? []).flatMap((item) => {
      if (item && typeof item === 'object' && 'children' in item && Array.isArray(item.children)) {
        return item.children
      }
      return [item]
    })
  }, [rawMenuItems, collapsed])

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
            {/* Logo 图标：暗黑模式下柔和微光，不刺眼 */}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--ant-color-primary)] text-base text-[var(--ant-color-text-light-solid)] shadow-sm dark:bg-blue-950/70 dark:text-blue-400 dark:border dark:border-blue-500/30 dark:shadow-[0_0_10px_rgba(59,130,246,0.18)]">
              <BookOutlined />
            </div>
            <div
              className={`flex min-w-0 items-center gap-2 transition-all duration-200 ${
                collapsed ? 'max-w-0 opacity-0 pointer-events-none' : 'max-w-32 opacity-100'
              }`}
            >
              <Typography.Title level={4} className="m-0! tracking-tight text-base font-bold">
                Loci
              </Typography.Title>
              <Tag color="blue" className="m-0! text-[10px] scale-90 origin-left">
                v1.2
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

            <Space size={8} className="items-center">
              <WorkspaceSwitcher />
              {/* 分隔线：区分左侧导航类（工作区切换）和右侧工具类（任务 + 用户） */}
              <div className="h-4 w-px bg-[var(--ant-color-border-secondary)]" />
              <ActiveTaskIndicator />
              <UserAvatarDropdown />
            </Space>
          </Layout.Header>

          {rawLayout ? (
            // raw 布局：全屏工作区直接撑满，无外边距和白色面板（LibraryBrowserWorkspace 等使用）
            <Layout.Content className="min-h-0 flex-1 overflow-hidden bg-[var(--ant-color-bg-layout)]">
              {children}
            </Layout.Content>
          ) : (
            // 普通布局：白色圆角内容面板浮在灰色衬底上
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

const localMenuItems: MenuProps['items'] = [
  {
    type: 'group',
    label: '知识管理',
    children: [
      {
        key: '/',
        icon: <DashboardOutlined />,
        label: <Link to="/">概览看板</Link>
      },
      {
        key: '/documents',
        icon: <BookOutlined />,
        label: <Link to="/documents">本地文档库</Link>
      },
      {
        key: '/cloud',
        icon: <CloudDownloadOutlined />,
        label: <Link to="/cloud">云端公开库</Link>
      }
    ]
  },
  {
    type: 'group',
    label: '任务与审计',
    children: [
      {
        key: '/jobs',
        icon: <SyncOutlined />,
        label: <Link to="/jobs">任务中心</Link>
      },
      {
        key: '/logs',
        icon: <ProfileOutlined />,
        label: <Link to="/logs">操作日志</Link>
      }
    ]
  },
  {
    type: 'group',
    label: '集成与配置',
    children: [
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
        label: <Link to="/settings">系统设置</Link>
      }
    ]
  }
]

const cloudMenuItems: MenuProps['items'] = [
  {
    type: 'group',
    label: '概览',
    children: [
      {
        key: '/admin',
        icon: <DashboardOutlined />,
        label: <Link to="/admin">Server 概览</Link>
      }
    ]
  },
  {
    type: 'group',
    label: '内容管理',
    children: [
      {
        key: '/admin/libraries',
        icon: <BookOutlined />,
        label: <Link to="/admin/libraries">Server 文档库</Link>
      },
      {
        key: '/admin/catalog',
        icon: <EyeOutlined />,
        label: <Link to="/admin/catalog">公开目录预览</Link>
      }
    ]
  },
  {
    type: 'group',
    label: '任务与策略',
    children: [
      {
        key: '/admin/jobs',
        icon: <SyncOutlined />,
        label: <Link to="/admin/jobs">同步任务</Link>
      },
      {
        key: '/admin/hostname-policies',
        icon: <ControlOutlined />,
        label: <Link to="/admin/hostname-policies">抓取策略</Link>
      }
    ]
  },
  {
    type: 'group',
    label: '审计与诊断',
    children: [
      {
        key: '/admin/audit-logs',
        icon: <AuditOutlined />,
        label: <Link to="/admin/audit-logs">管理操作记录</Link>
      },
      {
        key: '/admin/browser',
        icon: <DesktopOutlined />,
        label: <Link to="/admin/browser">无头浏览器</Link>
      }
    ]
  }
]
