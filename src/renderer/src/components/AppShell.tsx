import {
  AppstoreOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { Layout, Menu, Typography } from 'antd'
import type { MenuProps } from 'antd'
import type { ReactNode } from 'react'
import type { ViewKey } from '@renderer/routes/navigation'

const { Sider, Content } = Layout

interface AppShellProps {
  activeView: ViewKey
  onViewChange: (view: ViewKey) => void
  children: ReactNode
}

function AppShell({ activeView, onViewChange, children }: AppShellProps): React.JSX.Element {
  const menuItems: MenuProps['items'] = [
    { key: 'overview', icon: <AppstoreOutlined />, label: '总览' },
    { key: 'sources', icon: <DatabaseOutlined />, label: '文档源' },
    { key: 'library', icon: <FileSearchOutlined />, label: '知识库' }
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
        className="h-screen! flex! flex-col! overflow-y-auto!"
      >
        <div className="flex h-16 items-center gap-3 px-5">
          <FileSearchOutlined className="text-xl" />
          <div>
            <Typography.Text strong className="block">
              Loci
            </Typography.Text>
            <Typography.Text type="secondary" className="text-xs">
              本地知识库
            </Typography.Text>
          </div>
        </div>
        <div className="flex-1 px-3">
          <Menu
            mode="inline"
            selectedKeys={[activeView]}
            items={menuItems}
            onClick={({ key }) => onViewChange(key as ViewKey)}
          />
        </div>
        <div className="border-t border-t-solid border-t-[var(--ant-color-border-secondary)] px-3 py-3">
          <Menu
            mode="inline"
            selectedKeys={[activeView]}
            items={settingsItem}
            onClick={({ key }) => onViewChange(key as ViewKey)}
          />
        </div>
      </Sider>
      <Layout className="min-h-0 min-w-0">
        <Content className="min-h-0 overflow-y-auto p-6">{children}</Content>
      </Layout>
    </Layout>
  )
}

export default AppShell
