import { ArrowLeftOutlined, HomeOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Button, Space, Typography } from 'antd'
import { ThemeSwitcher } from '@/components/shell/ThemeSwitcher'

/** 独立全屏 404 页面：极简纯净、克制聚焦，提供清晰的返回导航。 */
export function NotFoundPage(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <main className="relative flex h-full w-full flex-col items-center justify-center bg-[var(--ant-color-bg-layout)] p-6 overflow-hidden select-none">
      {/* 顶部右上角快捷主题切换 */}
      <div className="absolute top-6 right-8 md:top-8 md:right-12 z-20">
        <ThemeSwitcher />
      </div>

      {/* 氛围微光背景 */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.06),transparent_60%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.12),transparent_70%)]" />

      <div className="relative z-10 flex flex-col items-center text-center max-w-md px-4">
        {/* 极简大号 404 标识 */}
        <div className="font-black text-8xl sm:text-9xl tracking-tighter leading-none text-[var(--ant-color-primary)] opacity-90 select-none">
          404
        </div>

        <Typography.Title level={3} className="mt-4! mb-2! font-bold tracking-tight">
          页面不存在
        </Typography.Title>

        <Typography.Paragraph type="secondary" className="m-0! text-sm">
          您请求的页面可能已移除、重命名，或访问路径有误。
        </Typography.Paragraph>

        {location.pathname && (
          <div className="mt-3 font-mono text-xs text-[var(--ant-color-text-tertiary)] max-w-xs truncate">
            {location.pathname}
          </div>
        )}

        <Space size={12} className="mt-8">
          <Button
            type="primary"
            size="large"
            icon={<HomeOutlined />}
            onClick={() => void navigate({ to: '/' })}
          >
            返回首页
          </Button>
          <Button size="large" icon={<ArrowLeftOutlined />} onClick={() => window.history.back()}>
            返回上一页
          </Button>
        </Space>
      </div>
    </main>
  )
}
