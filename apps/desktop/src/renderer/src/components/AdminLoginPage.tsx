import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  LockOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons'
import { Button, Card, Form, Input, Skeleton, Space, Tag, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { CloudAdminLoginInput } from '@loci/shared'
import { useCloudAdmin } from '../cloud-admin-context'
import { useAppSettings } from '../settings-context'

function AdminLoginPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { session, loading, login } = useCloudAdmin()
  const { state: settingsState } = useAppSettings()
  const [submitting, setSubmitting] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    if (!loading && session) void navigate({ to: '/admin/cloud' })
  }, [loading, navigate, session])

  const handleLogin = (values: CloudAdminLoginInput): void => {
    setSubmitting(true)
    void login(values)
      .then(() => navigate({ to: '/admin/cloud' }))
      .catch((error: unknown) =>
        messageApi.error(error instanceof Error ? error.message : '管理员登录失败')
      )
      .finally(() => setSubmitting(false))
  }

  return (
    <main className="grid min-h-screen grid-cols-1 bg-[var(--ant-color-bg-layout)] lg:grid-cols-[minmax(420px,1.05fr)_minmax(440px,0.95fr)]">
      {contextHolder}
      <section className="relative hidden overflow-hidden border-r border-r-solid border-r-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -left-28 top-1/3 h-72 w-72 rounded-full bg-[var(--ant-color-primary-bg)] blur-3xl" />
        <div className="relative">
          <div className="mb-16 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--ant-color-primary)] text-white">
              <CloudServerOutlined className="text-xl" />
            </div>
            <div>
              <Typography.Text strong className="block">
                Loci Control Plane
              </Typography.Text>
              <Typography.Text type="secondary" className="text-xs">
                云文档管理入口
              </Typography.Text>
            </div>
          </div>
          <Typography.Title className="max-w-xl" level={1}>
            本地知识保持本地，
            <br />
            云端只负责发布文档。
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="mt-5 max-w-lg text-base leading-7!">
            超级管理员可以维护服务器文档源、更新计划与发布状态。桌面端本地文档不会上传。
          </Typography.Paragraph>
        </div>

        <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-2xl border border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-elevated)] p-5 shadow-sm">
          <TopologyNode icon={<DatabaseOutlined />} title="本地节点" detail="私有 · 不上传" />
          <div className="flex items-center gap-2 text-[var(--ant-color-text-tertiary)]">
            <span className="h-px w-8 bg-[var(--ant-color-border)]" />
            <ArrowRightOutlined />
            <span className="h-px w-8 bg-[var(--ant-color-border)]" />
          </div>
          <TopologyNode
            icon={<CloudServerOutlined />}
            title="云端控制面"
            detail="公开文档发布"
            primary
          />
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            className="mb-6 -ml-3"
            onClick={() => void navigate({ to: '/settings' })}
          >
            返回设置
          </Button>
          {loading || session ? (
            <Card variant="borderless">
              <Skeleton active paragraph={{ rows: 6 }} />
            </Card>
          ) : (
            <Card className="rounded-2xl! shadow-sm" styles={{ body: { padding: 32 } }}>
              <Space direction="vertical" size={6} className="mb-7 w-full">
                <Tag bordered={false} color="blue" className="w-fit">
                  <SafetyCertificateOutlined /> 超级管理员
                </Tag>
                <Typography.Title level={2} className="mb-0!">
                  连接 Loci Server
                </Typography.Title>
                <Typography.Text type="secondary">
                  登录凭据只用于本次桌面会话，退出应用后需要重新登录。
                </Typography.Text>
              </Space>
              <Form<CloudAdminLoginInput>
                layout="vertical"
                initialValues={{ username: 'admin' }}
                requiredMark={false}
                onFinish={handleLogin}
              >
                <div className="mb-5 rounded-lg border border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-3">
                  <Typography.Text type="secondary" className="block text-xs">
                    当前后端
                  </Typography.Text>
                  <Typography.Text className="mt-1 block font-mono text-sm">
                    {settingsState.settings.serverUrl}
                  </Typography.Text>
                </div>
                <Form.Item
                  name="username"
                  label="管理员账号"
                  rules={[{ required: true, message: '请输入管理员账号' }]}
                >
                  <Input size="large" placeholder="admin" autoComplete="username" />
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
                  loading={submitting}
                  icon={<ArrowRightOutlined />}
                  iconPosition="end"
                >
                  登录并进入管理界面
                </Button>
              </Form>
              <Typography.Paragraph type="secondary" className="mb-0! mt-5! text-center text-xs">
                请仅连接你信任的 Loci Server。
              </Typography.Paragraph>
            </Card>
          )}
        </div>
      </section>
    </main>
  )
}

function TopologyNode({
  icon,
  title,
  detail,
  primary = false
}: {
  icon: React.ReactNode
  title: string
  detail: string
  primary?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${primary ? 'bg-[var(--ant-color-primary)] text-white' : 'bg-[var(--ant-color-fill-secondary)]'}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <Typography.Text strong className="block truncate">
          {title}
        </Typography.Text>
        <Typography.Text type="secondary" className="block truncate text-xs">
          {detail}
        </Typography.Text>
      </div>
    </div>
  )
}

export default AdminLoginPage
