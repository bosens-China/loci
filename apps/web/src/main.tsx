import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider } from 'antd'
import '@unocss/reset/tailwind.css'
import 'uno.css'
import { App } from '@/App'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 }
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#0a7c86',
          colorInfo: '#0a7c86',
          colorSuccess: '#2f7d5c',
          colorWarning: '#c77a17',
          colorError: '#b6423c',
          borderRadius: 10,
          fontFamily: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif'
        }
      }}
    >
      <QueryClientProvider client={queryClient}>
        <AntApp>
          <App />
        </AntApp>
      </QueryClientProvider>
    </ConfigProvider>
  </React.StrictMode>
)
