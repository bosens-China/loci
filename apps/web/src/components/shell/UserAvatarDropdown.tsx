import {
  DesktopOutlined,
  LoginOutlined,
  LogoutOutlined,
  MoonOutlined,
  SunOutlined,
  UserOutlined
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { App, Avatar, Button, Dropdown, Segmented, Tag } from 'antd'
import type { ThemeMode } from '@loci/shared'
import { getAdminSession, logoutAdmin } from '@/api/admin'
import { getSettings, saveSettings } from '@/api/settings'
import { useResolvedTheme } from '@/hooks/use-resolved-theme'
import {
  ADMIN_JOBS_KEY,
  ADMIN_LIBRARIES_KEY,
  ADMIN_SESSION_KEY
} from '@/pages/admin/admin-query-keys'
import { formatDateTime } from '@/utils/format'

/** 顶栏右侧用户区：支持登录与未登录全状态下拉面板，集成账号状态、主题切换与会话操作。 */
export function UserAvatarDropdown(): React.JSX.Element {
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const client = useQueryClient()

  const session = useQuery({
    queryKey: ADMIN_SESSION_KEY,
    queryFn: getAdminSession,
    staleTime: 30_000
  })

  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const currentMode: ThemeMode = settings.data?.theme ?? 'auto'
  const resolvedTheme = useResolvedTheme(currentMode)
  void resolvedTheme

  const themeMutation = useMutation({
    mutationFn: async (theme: ThemeMode) => {
      const current = settings.data ?? (await getSettings())
      return saveSettings({ ...current, theme })
    },
    onMutate: async (newTheme) => {
      await client.cancelQueries({ queryKey: ['settings'] })
      const previous = client.getQueryData<typeof settings.data>(['settings'])
      client.setQueryData(['settings'], (old: typeof settings.data) =>
        old ? { ...old, theme: newTheme } : old
      )
      return { previous }
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['settings'] }),
    onError: (_err, _newTheme, context) => {
      if (context?.previous) client.setQueryData(['settings'], context.previous)
    }
  })

  const logout = useMutation({
    mutationFn: logoutAdmin,
    onSuccess: () => {
      client.setQueryData(ADMIN_SESSION_KEY, null)
      client.removeQueries({ queryKey: ADMIN_LIBRARIES_KEY })
      client.removeQueries({ queryKey: ADMIN_JOBS_KEY })
      void message.success('管理员已退出')
      if (location.pathname.startsWith('/admin')) void navigate({ to: '/' })
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const confirmLogout = (): void => {
    modal.confirm({
      title: '确认退出管理员账号？',
      content: '退出后将无法继续管理远程 Server 文档库与发布任务。',
      okText: '退出登录',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => logout.mutateAsync()
    })
  }

  const isLoggedIn = Boolean(session.data)

  const dropdownPanel = (
    <div className="w-72 overflow-hidden rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-elevated)] p-2.5 shadow-xl dark:shadow-[0_12px_36px_rgba(0,0,0,0.7)] text-[var(--ant-color-text)]">
      {/* 头部账号卡片 */}
      <div className="rounded-lg bg-[var(--ant-color-fill-quaternary)] p-3 border border-[var(--ant-color-border-secondary)] mb-2">
        {isLoggedIn && session.data ? (
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Avatar
                  size={20}
                  icon={<UserOutlined />}
                  className="bg-[var(--ant-color-primary)]! text-[var(--ant-color-text-light-solid)]!"
                />
                <span className="font-semibold text-xs text-[var(--ant-color-text)]">
                  {session.data.username}
                </span>
              </div>
              <Tag color="success" className="m-0! text-[10px] px-1.5 py-0">
                已连接
              </Tag>
            </div>
            <div className="mt-1.5 truncate font-mono text-[11px] text-[var(--ant-color-text-secondary)]">
              {session.data.serverUrl}
            </div>
            <div className="mt-0.5 text-[10px] text-[var(--ant-color-text-tertiary)]">
              有效期至 {formatDateTime(session.data.expiresAt)}
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs text-[var(--ant-color-text)]">
                未登录管理员
              </span>
              <Tag className="m-0! text-[10px] px-1.5 py-0">离线模式</Tag>
            </div>
            <p className="mt-1 mb-2.5 text-[11px] text-[var(--ant-color-text-secondary)] leading-relaxed">
              登录以管理远程 Server 文档库与发布抓取任务
            </p>
            <Button
              type="primary"
              size="small"
              icon={<LoginOutlined />}
              block
              onClick={() => void navigate({ to: '/login', search: { redirect: '/admin' } })}
            >
              登录管理员账号
            </Button>
          </div>
        )}
      </div>

      {/* 外观切换：换行块级布局，支持动画和深浅色自适应 */}
      <div className="px-1 py-2 border-b border-[var(--ant-color-border-secondary)] mb-1">
        <div className="text-[11px] font-medium text-[var(--ant-color-text-secondary)] mb-1.5 px-0.5">
          外观主题
        </div>
        <Segmented<ThemeMode>
          size="small"
          block
          value={currentMode}
          onChange={(val) => themeMutation.mutate(val)}
          options={[
            { value: 'light', icon: <SunOutlined />, label: '浅色' },
            { value: 'dark', icon: <MoonOutlined />, label: '深色' },
            { value: 'auto', icon: <DesktopOutlined />, label: '跟随系统' }
          ]}
        />
      </div>

      {/* 退出登录（仅已登录显示） */}
      {isLoggedIn && (
        <div className="border-t border-[var(--ant-color-border-secondary)] pt-1 mt-1">
          <div
            role="button"
            tabIndex={0}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-[var(--ant-color-error)] transition-colors hover:bg-[var(--ant-color-error-bg)]"
            onClick={confirmLogout}
          >
            <LogoutOutlined className="text-xs" />
            <span>退出登录</span>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <Dropdown
      popupRender={() => dropdownPanel}
      placement="bottomRight"
      trigger={['hover', 'click']}
    >
      <Button
        type="text"
        className="flex h-8 items-center gap-1.5 px-1.5 hover:bg-[var(--ant-color-fill-quaternary)]"
        aria-label="用户与系统设置"
      >
        <Avatar
          size={24}
          icon={<UserOutlined />}
          className={
            isLoggedIn
              ? 'bg-[var(--ant-color-primary)]! text-[var(--ant-color-text-light-solid)]!'
              : 'bg-[var(--ant-color-fill-secondary)]! text-[var(--ant-color-text-secondary)]!'
          }
        />
        {isLoggedIn && session.data ? (
          <span className="hidden max-w-24 truncate text-xs font-medium sm:inline">
            {session.data.username}
          </span>
        ) : null}
      </Button>
    </Dropdown>
  )
}
