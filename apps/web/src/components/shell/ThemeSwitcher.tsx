import { MoonOutlined, SunOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Tooltip } from 'antd'
import type { AppSettings, ThemeMode } from '@loci/shared'
import { getSettings, saveSettings } from '@/api/settings'
import { useResolvedTheme } from '@/hooks/use-resolved-theme'
import { getStoredThemeMode, setStoredThemeMode } from '@/utils/theme'

/** 顶栏主题切换按钮：单击在浅色与深色之间切换，图标展示当前实际生效的主题。 */
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
    onSuccess: () => void client.invalidateQueries({ queryKey: ['settings'] }),
    onError: (_err, _newTheme, context) => {
      if (context?.previous) client.setQueryData(['settings'], context.previous)
      void message.error('主题切换失败')
    }
  })

  // 点击直接在浅色 / 深色间切换；"跟随系统" 仍可在设置页选择
  const isDark = resolvedTheme === 'dark'
  const nextTheme: ThemeMode = isDark ? 'light' : 'dark'
  const tooltip = `${currentMode === 'auto' ? '当前跟随系统，' : ''}切换到${isDark ? '浅色' : '深色'}模式`

  return (
    <Tooltip title={tooltip} placement="bottomRight">
      <Button
        shape="circle"
        type="text"
        icon={isDark ? <MoonOutlined /> : <SunOutlined />}
        onClick={() => mutation.mutate(nextTheme)}
        className="text-[var(--ant-color-text-secondary)]"
        aria-label={tooltip}
      />
    </Tooltip>
  )
}
