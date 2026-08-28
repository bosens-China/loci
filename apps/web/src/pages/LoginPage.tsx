import { CloudServerOutlined, LockOutlined, UserOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Alert, App, Button, Card, Form, Input, Typography } from 'antd'
import type { CloudAdminLoginInput } from '@loci/shared'
import { loginAdmin } from '@/api/admin'
import { getSettings } from '@/api/settings'
import { ThemeSwitcher } from '@/components/shell/ThemeSwitcher'
import { ADMIN_SESSION_KEY } from '@/pages/admin/admin-query-keys'

interface LoginSearch {
  redirect?: string
}

/** 独立管理员登录页：用于登录目标 Loci Server，支持多主题与深色模式自适应。 */
export function LoginPage(): React.JSX.Element {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const client = useQueryClient()
  const search = useSearch({ strict: false }) as LoginSearch
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings })

  const login = useMutation({
    mutationFn: loginAdmin,
    onSuccess: (session) => {
      client.setQueryData(ADMIN_SESSION_KEY, session)
      void message.success('管理员已登录')
      const target =
        search.redirect && search.redirect !== '/' && search.redirect !== '/login'
          ? search.redirect
          : '/admin'
      void navigate({ to: target })
    },
    onError: (error: Error) => void message.error(error.message)
  })

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-[var(--ant-color-bg-layout)] p-4 overflow-hidden">
      {/* 顶部右上角快捷主题切换 */}
      <div className="absolute top-4 right-4 z-10">
        <ThemeSwitcher />
      </div>

      {/* 装饰性暗黑模式微光氛围背景 */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.06),transparent_60%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.12),transparent_70%)]" />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 text-center">
          {/* Logo 容器：自适应暗黑模式柔光 */}
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--ant-color-primary)] text-2xl text-[var(--ant-color-text-light-solid)] shadow-md dark:bg-blue-950/70 dark:text-blue-400 dark:border dark:border-blue-500/30 dark:shadow-[0_0_18px_rgba(59,130,246,0.22)]">
            <CloudServerOutlined />
          </div>
          <Typography.Title level={2} className="m-0! tracking-tight font-bold">
            Loci Server 管理
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="mt-2! mb-0! text-xs">
            面向 AI Agent 的本地优先技术文档知识库 · 远程控制台
          </Typography.Paragraph>
        </div>

        <Card className="shadow-md border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
          <Alert
            type="info"
            showIcon
            className="mb-5 text-xs border-[var(--ant-color-border-secondary)]"
            title={
              <div className="flex items-center justify-between gap-2">
                <span>目标 Server:</span>
                <span className="font-mono">{settings.data?.serverUrl || '—'}</span>
              </div>
            }
          />

          <Form<CloudAdminLoginInput>
            layout="vertical"
            initialValues={{ username: 'admin' }}
            onFinish={(value) => login.mutate(value)}
          >
            <Form.Item
              name="username"
              label="管理员账号"
              rules={[{ required: true, message: '请输入管理员账号' }]}
            >
              <Input size="large" prefix={<UserOutlined />} autoComplete="username" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                autoComplete="current-password"
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={login.isPending}
              className="mt-2"
            >
              登录并进入 Server 管理
            </Button>
          </Form>

          <div className="mt-4 text-center">
            <Button type="link" size="small" onClick={() => void navigate({ to: '/' })}>
              返回本地工作区
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
