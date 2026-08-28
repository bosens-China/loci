import { CheckOutlined, CloudServerOutlined, DownOutlined, HomeOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Button, Dropdown, type MenuProps } from 'antd'

export type WorkspaceMode = 'local' | 'cloud'

/** 顶部工作区切换器：pill 样式，强调当前工作区状态，下拉菜单快速切换。 */
export function WorkspaceSwitcher(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const isCloud = location.pathname.startsWith('/admin')

  const items: MenuProps['items'] = [
    {
      key: 'local',
      icon: <HomeOutlined className={!isCloud ? 'text-[var(--ant-color-primary)]' : undefined} />,
      label: (
        <div className="flex items-center justify-between gap-4 py-0.5">
          <span className={!isCloud ? 'font-semibold text-[var(--ant-color-primary)]' : undefined}>
            本地工作区
          </span>
          {!isCloud && <CheckOutlined className="text-xs text-[var(--ant-color-primary)]" />}
        </div>
      ),
      onClick: () => {
        if (isCloud) void navigate({ to: '/' })
      }
    },
    {
      key: 'cloud',
      icon: (
        <CloudServerOutlined className={isCloud ? 'text-[var(--ant-color-primary)]' : undefined} />
      ),
      label: (
        <div className="flex items-center justify-between gap-4 py-0.5">
          <span className={isCloud ? 'font-semibold text-[var(--ant-color-primary)]' : undefined}>
            Server 管理
          </span>
          {isCloud && <CheckOutlined className="text-xs text-[var(--ant-color-primary)]" />}
        </div>
      ),
      onClick: () => {
        if (!isCloud) void navigate({ to: '/admin' })
      }
    }
  ]

  return (
    <Dropdown menu={{ items }} trigger={['hover', 'click']} placement="bottomLeft" arrow>
      {/* pill 样式：带背景和圆角，强调这是一个状态选择器而非普通按钮 */}
      <Button
        type="text"
        className="flex h-7 items-center gap-1.5 rounded-full border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] px-3 text-xs font-medium text-[var(--ant-color-text)] hover:bg-[var(--ant-color-fill-secondary)] hover:border-[var(--ant-color-border)]"
      >
        {isCloud ? (
          <CloudServerOutlined className="text-[11px] text-[var(--ant-color-primary)]" />
        ) : (
          <HomeOutlined className="text-[11px] text-[var(--ant-color-primary)]" />
        )}
        <span>{isCloud ? 'Server 管理' : '本地工作区'}</span>
        <DownOutlined className="text-[9px] text-[var(--ant-color-text-tertiary)]" />
      </Button>
    </Dropdown>
  )
}
