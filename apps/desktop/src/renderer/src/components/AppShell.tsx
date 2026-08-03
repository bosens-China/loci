import {
  AppstoreOutlined,
  CloudServerOutlined,
  CloudDownloadOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { Button, Layout, Menu, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useState, type ReactNode } from 'react'
import type { ViewKey } from '../routes/navigation'
import { useCloudAdmin } from '../cloud-admin-context'

const { Sider, Content } = Layout

interface AppShellProps {
  activeView: ViewKey
  onViewChange: (view: ViewKey) => void
  children: ReactNode
}

function AppShell({ activeView, onViewChange, children }: AppShellProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const { session } = useCloudAdmin()

  const menuItems: MenuProps['items'] = [
    {
      type: 'group',
      label: '本地知识库',
      children: [
        { key: 'overview', icon: <AppstoreOutlined />, label: '总览' },
        { key: 'sources', icon: <DatabaseOutlined />, label: '文档源' },
        { key: 'library', icon: <FileSearchOutlined />, label: '知识库' },
        { key: 'cloudCatalog', icon: <CloudDownloadOutlined />, label: '云端资源' }
      ]
    },
    ...(session
      ? [
          { type: 'divider' as const },
          {
            type: 'group' as const,
            label: '云端管理',
            children: [
              {
                key: 'cloudLibraries',
                icon: <CloudServerOutlined />,
                label: '云文档管理'
              }
            ]
          }
        ]
      : [])
  ]
  const settingsItem: MenuProps['items'] = [
    { key: 'settings', icon: <SettingOutlined />, label: '设置' }
  ]

  return (
    <Layout className="h-screen overflow-hidden">
      <Sider
        width={232}
        theme="light"
        breakpoint="lg"
        collapsedWidth={0}
        collapsed={collapsed}
        onCollapse={setCollapsed}
        className="h-screen! relative! [&>.ant-layout-sider-children]:flex [&>.ant-layout-sider-children]:flex-col [&>.ant-layout-sider-children]:h-full [&_.ant-menu-inline]:border-r-0! [&_.ant-menu]:border-r-0!"
      >
        <div className="flex h-16 items-center justify-between px-5">
          <div className="flex items-center gap-3 min-w-0">
            <FileSearchOutlined className="text-xl shrink-0" />
            <div className="min-w-0 overflow-hidden">
              <Typography.Text strong className="block truncate">
                Loci
              </Typography.Text>
              <Typography.Text type="secondary" className="text-xs block truncate">
                {session ? '超级管理员' : '本地知识库'}
              </Typography.Text>
            </div>
          </div>
          <Button
            type="text"
            size="small"
            icon={<MenuFoldOutlined />}
            aria-label="折叠侧边栏"
            onClick={() => setCollapsed(true)}
          />
        </div>
        <div className="flex-1 px-3">
          <Menu
            mode="inline"
            style={{ borderRight: 0 }}
            className="border-r-0!"
            selectedKeys={[activeView]}
            items={menuItems}
            onClick={({ key }) => onViewChange(key as ViewKey)}
          />
        </div>
        <div className="border-t border-t-solid border-t-[var(--ant-color-border-secondary)] px-3 py-3">
          <Menu
            mode="inline"
            style={{ borderRight: 0 }}
            className="border-r-0!"
            selectedKeys={[activeView]}
            items={settingsItem}
            onClick={({ key }) => onViewChange(key as ViewKey)}
          />
        </div>
      </Sider>
      <Layout className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Content className="relative flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto p-6">
          {collapsed && (
            <Button
              type="default"
              size="small"
              icon={<MenuUnfoldOutlined />}
              aria-label="展开侧边栏"
              className="absolute left-4 top-4 z-10"
              onClick={() => setCollapsed(false)}
            />
          )}
          <div className={`flex-1 min-h-0 h-full flex flex-col ${collapsed ? 'pt-6' : ''}`}>
            {children}
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}

export default AppShell
