import { ArrowLeftOutlined, BookOutlined, CompassOutlined, HomeOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Button, Card, Result, Space, Typography } from 'antd'

/** 独立全屏 404 页面：紧凑精致居中，彻底消除多余滚动条，完美支持 Dark 与 Light 模式。 */
export function NotFoundPage(): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <main className="h-full w-full flex flex-col items-center justify-center bg-[var(--ant-color-bg-layout)] p-4 overflow-hidden select-none">
      {/* 顶部 Brand 标识 */}
      <header className="mb-3.5 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--ant-color-primary)] text-white shadow-sm">
          <CompassOutlined className="text-lg" />
        </div>
        <span className="text-lg font-bold tracking-tight text-[var(--ant-color-text)]">Loci</span>
      </header>

      {/* 中央独立 404 容器卡片 */}
      <Card
        variant="outlined"
        styles={{ body: { padding: '16px 24px' } }}
        className="w-full max-w-md shadow-md border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] rounded-2xl overflow-hidden"
      >
        <Result
          status="404"
          className="p-0! [&_.ant-result-image]:h-28! [&_.ant-result-image]:mb-2! [&_.ant-result-image_svg]:max-h-28! [&_.ant-result-title]:text-2xl! [&_.ant-result-title]:mt-0! [&_.ant-result-subtitle]:text-xs!"
          title={
            <span className="font-extrabold text-2xl text-[var(--ant-color-text)] tracking-tight">
              404 页面未找到
            </span>
          }
          subTitle={
            <div className="space-y-1.5 mt-0.5">
              <p className="text-xs text-[var(--ant-color-text-secondary)] m-0">
                抱歉，您访问的页面不存在或已被移除。
              </p>
              {location.pathname && (
                <div className="text-xs text-[var(--ant-color-text-tertiary)] truncate">
                  请求路径：
                  <Typography.Text code className="text-xs">
                    {location.pathname}
                  </Typography.Text>
                </div>
              )}
            </div>
          }
          extra={
            <Space size={10} wrap className="justify-center mt-2">
              <Button
                type="primary"
                icon={<HomeOutlined />}
                onClick={() => void navigate({ to: '/' })}
              >
                返回概览看板
              </Button>
              <Button icon={<BookOutlined />} onClick={() => void navigate({ to: '/documents' })}>
                本地文档库
              </Button>
              <Button icon={<ArrowLeftOutlined />} onClick={() => window.history.back()}>
                返回上一页
              </Button>
            </Space>
          }
        />
      </Card>

      {/* 底部版权信息 */}
      <footer className="mt-4 text-xs text-[var(--ant-color-text-tertiary)]">
        © 2026 Loci Documentation Workspace
      </footer>
    </main>
  )
}
