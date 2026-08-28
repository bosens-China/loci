import { CloudServerOutlined, LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import type { CloudAdminLoginInput } from '@loci/shared'

/** 管理员登录面板：远程 Server 鉴权与登录表单。 */
export function AdminLoginPanel(props: {
  serverUrl: string
  submitting: boolean
  onSubmit: (input: CloudAdminLoginInput) => void
}): React.JSX.Element {
  return (
    <div className="mx-auto max-w-lg py-8">
      <Card>
        <div className="text-center">
          <CloudServerOutlined className="text-3xl text-[var(--ant-color-primary)]" />
          <Typography.Title level={3} className="mt-3! mb-1!">
            Server 管理员登录
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="mb-4! text-xs">
            本地文档不会上传。登录仅用于维护目标 Server 上的公开文档库与发布任务。
          </Typography.Paragraph>
        </div>

        <Alert
          type="info"
          showIcon
          className="mb-6 text-xs"
          title={
            <div className="flex items-center justify-between gap-2">
              <span>目标 Server</span>
              <span className="font-mono">{props.serverUrl}</span>
            </div>
          }
        />

        <Form<CloudAdminLoginInput>
          layout="vertical"
          initialValues={{ username: 'admin' }}
          onFinish={props.onSubmit}
        >
          <Form.Item
            name="username"
            label="管理员账号"
            rules={[{ required: true, message: '请输入账号' }]}
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
            loading={props.submitting}
            className="mt-2"
          >
            登录并进入管理界面
          </Button>
        </Form>
      </Card>
    </div>
  )
}
