import { App as AntApp, ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { useQuery } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { getSettings } from '@/api/settings'
import { useResolvedTheme } from '@/hooks/use-resolved-theme'
import { router } from '@/router'

dayjs.locale('zh-cn')

/** 将持久化主题设置映射为 Ant Design 默认主题与中文语言包。 */
export function AppProviders(): React.JSX.Element {
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const resolvedTheme = useResolvedTheme(settings.data?.theme ?? 'auto')

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: resolvedTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorBgLayout: resolvedTheme === 'dark' ? '#0d0e11' : '#f4f6f9',
          colorBgContainer: resolvedTheme === 'dark' ? '#16171b' : '#ffffff',
          colorBorderSecondary: resolvedTheme === 'dark' ? '#26282f' : '#f0f0f0'
        },
        cssVar: {}
      }}
    >
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  )
}
