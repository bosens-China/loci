import { CloudServerOutlined, LoginOutlined, LogoutOutlined } from '@ant-design/icons'
import {
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Space,
  Tag,
  Typography,
  message
} from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useCloudAdmin } from '@renderer/cloud-admin-context'
import { useAppSettings } from '@renderer/settings-context'

export function CloudAdminSettingsCard(): React.JSX.Element {
  const navigate = useNavigate()
  const { session, logout } = useCloudAdmin()
  const { state, save } = useAppSettings()
  const [form] = Form.useForm<{ serverUrl: string }>()
  const [saving, setSaving] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    form.setFieldValue('serverUrl', state.settings.serverUrl)
  }, [form, state.settings.serverUrl])

  const handleSaveServer = ({ serverUrl }: { serverUrl: string }): void => {
    const changed = serverUrl.trim() !== state.settings.serverUrl
    setSaving(true)
    void save({ ...state.settings, serverUrl })
      .then(async (saved) => {
        if (changed && session) await logout()
        form.setFieldValue('serverUrl', saved.settings.serverUrl)
        messageApi.success(
          changed && session ? '后端地址已保存，管理员会话已重置' : '后端地址已保存'
        )
      })
      .catch((error: unknown) =>
        messageApi.error(error instanceof Error ? error.message : '后端地址保存失败')
      )
      .finally(() => setSaving(false))
  }

  const handleLogout = (): void => {
    void logout()
      .then(() => messageApi.success('已退出超级管理员模式'))
      .catch(() => messageApi.success('本机会话已清除'))
  }

  return (
    <Card variant="borderless" className="bg-transparent!" styles={{ body: { paddingTop: 0 } }}>
      {contextHolder}
      <div className="mb-6 flex items-start gap-4 rounded-xl border border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-5">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--ant-color-primary-bg)] text-[var(--ant-color-primary)]">
          <CloudServerOutlined className="text-xl" />
        </div>
        <div>
          <Typography.Title level={4} className="mb-1!">
            云端管理员
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="mb-0!">
            登录后可以维护服务器上的公开文档源、抓取计划和同步状态。本地文档不会上传。
          </Typography.Paragraph>
        </div>
      </div>

      <Form form={form} layout="vertical" onFinish={handleSaveServer} className="mb-6">
        <Form.Item
          name="serverUrl"
          label="Loci Server 后端地址"
          extra="云端目录、云文档更新和管理员登录都会使用这个地址。"
          rules={[
            { required: true, message: '请输入后端地址' },
            { type: 'url', message: '请输入有效的 HTTP 或 HTTPS 地址' }
          ]}
        >
          <Input prefix={<CloudServerOutlined />} placeholder="https://docs.example.com" />
        </Form.Item>
        <Button htmlType="submit" loading={saving}>
          保存后端地址
        </Button>
      </Form>

      {session ? (
        <Space direction="vertical" size="large" className="w-full">
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="当前模式">
              <Tag color="blue">超级管理员</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="服务器">{session.serverUrl}</Descriptions.Item>
            <Descriptions.Item label="账号">{session.username}</Descriptions.Item>
          </Descriptions>
          <Space wrap>
            <Button type="primary" onClick={() => void navigate({ to: '/admin/cloud' })}>
              进入云文档管理
            </Button>
            <Popconfirm
              title="退出超级管理员模式？"
              description="云端管理入口将从侧边栏隐藏。"
              onConfirm={handleLogout}
            >
              <Button danger icon={<LogoutOutlined />}>
                退出登录
              </Button>
            </Popconfirm>
          </Space>
        </Space>
      ) : (
        <div>
          <Typography.Paragraph type="secondary">
            当前为普通本地模式。管理员登录不会改变本地文档的所有权或同步方向。
          </Typography.Paragraph>
          <Button
            type="primary"
            icon={<LoginOutlined />}
            onClick={() => void navigate({ to: '/admin/login' })}
          >
            登录超级管理员
          </Button>
        </div>
      )}
    </Card>
  )
}
