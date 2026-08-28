import { CheckOutlined, DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Dropdown, type MenuProps } from 'antd'
import type { AppSettings, ThemeMode } from '@loci/shared'
import { getSettings, saveSettings } from '@/api/settings'
import { useResolvedTheme } from '@/hooks/use-resolved-theme'
import { getStoredThemeMode, setStoredThemeMode } from '@/utils/theme'

const THEME_OPTIONS = [
  { value: 'light', label: '浅色模式', icon: <SunOutlined /> },
  { value: 'dark', label: '深色模式', icon: <MoonOutlined /> },
  { value: 'auto', label: '跟随系统', icon: <DesktopOutlined /> }
] as const

/** 快捷主题切换按钮：支持图标展示当前模式，下拉菜单快速切换 浅色 / 深色 / 跟随系统。 */
export function ThemeSwitcher(): React.JSX.Element {
  const { message } = App.useApp()
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const currentMode: ThemeMode = settings.data?.theme ?? getStoredThemeMode()
  const resolvedTheme = useResolvedTheme(currentMode)

  const mutation = useMutation({
    mutationFn: async (theme: ThemeMode) => {
      setStoredThemeMode(theme)
      const current = settings.data ?? (await getSettings().catch(() => null))
      if (current) {
        return saveSettings({ ...current, theme })
      }
      return undefined
    },
    onMutate: async (newTheme) => {
      setStoredThemeMode(newTheme)
      await client.cancelQueries({ queryKey: ['settings'] })
      const previous = client.getQueryData<AppSettings>(['settings'])
      if (previous) {
        client.setQueryData<AppSettings>(['settings'], { ...previous, theme: newTheme })
      }
      return { previous }
    },
    onSuccess: (_, newTheme) => {
      void client.invalidateQueries({ queryKey: ['settings'] })
      const label = newTheme === 'light' ? '浅色' : newTheme === 'dark' ? '深色' : '跟随系统'
      void message.success(`已切换为${label}模式`)
    },
    onError: (_err, _newTheme, context) => {
      if (context?.previous) client.setQueryData(['settings'], context.previous)
      void message.error('主题切换失败')
    }
  })

  const currentIcon =
    currentMode === 'light' ? (
      <SunOutlined className="text-base" />
    ) : currentMode === 'dark' ? (
      <MoonOutlined className="text-base" />
    ) : resolvedTheme === 'dark' ? (
      <MoonOutlined className="text-base" />
    ) : (
      <DesktopOutlined className="text-base" />
    )

  const items: MenuProps['items'] = THEME_OPTIONS.map((option) => ({
    key: option.value,
    icon: option.icon,
    label: (
      <span className="flex items-center justify-between gap-4">
        <span>{option.label}</span>
        {currentMode === option.value && (
          <CheckOutlined className="text-xs text-[var(--ant-color-primary)]" />
        )}
      </span>
    ),
    onClick: () => mutation.mutate(option.value)
  }))

  return (
    <Dropdown menu={{ items }} placement="bottomRight" arrow trigger={['hover', 'click']}>
      <Button
        shape="circle"
        type="text"
        icon={currentIcon}
        className="flex h-9 w-9 items-center justify-center border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] shadow-xs hover:border-[var(--ant-color-primary)] text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)] transition-colors cursor-pointer"
        aria-label="切换界面主题"
        title={`当前主题：${currentMode === 'light' ? '浅色' : currentMode === 'dark' ? '深色' : '跟随系统'}`}
      />
    </Dropdown>
  )
}
