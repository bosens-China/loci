import { App as AntApp, ConfigProvider, theme as antdTheme } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { getSettings } from '@/api/settings'
import { useResolvedTheme } from '@/hooks/use-resolved-theme'
import { router } from '@/router'

/** 将持久化主题设置映射为 Ant Design 默认主题。 */
export function AppProviders(): React.JSX.Element {
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const resolvedTheme = useResolvedTheme(settings.data?.theme ?? 'auto')

  return (
    <ConfigProvider
      theme={{
        algorithm: resolvedTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: {}
      }}
    >
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  )
}
