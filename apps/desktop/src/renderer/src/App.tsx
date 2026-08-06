import { RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { ConfigProvider, theme as antdTheme } from 'antd'
import { useEffect } from 'react'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { router } from './router'
import SettingsProvider from './SettingsProvider'
import { useAppSettings } from './settings-context'
import { useResolvedTheme } from './settings-theme'
import { CloudAdminProvider } from './CloudAdminProvider'
import { queryClient, queryKeys } from './query-client'

dayjs.locale('zh-cn')

function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ExternalDataInvalidation />
      <SettingsProvider>
        <ThemedApp />
      </SettingsProvider>
    </QueryClientProvider>
  )
}

/** 主进程通知本地数据库变化时，只失效共享缓存，不让各页面重复订阅。 */
function ExternalDataInvalidation(): null {
  const client = useQueryClient()
  useEffect(
    () =>
      window.api.onExternalDataChange(
        () => void client.invalidateQueries({ queryKey: queryKeys.localData })
      ),
    [client]
  )
  return null
}

function ThemedApp(): React.JSX.Element {
  const { state } = useAppSettings()
  const resolvedTheme = useResolvedTheme(state.settings.theme)
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: resolvedTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: 'loci' }
      }}
    >
      <CloudAdminProvider>
        <RouterProvider router={router} />
      </CloudAdminProvider>
    </ConfigProvider>
  )
}

export default App
