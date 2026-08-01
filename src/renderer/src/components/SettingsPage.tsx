import {
  BgColorsOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  DesktopOutlined,
  MoonOutlined
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Form,
  InputNumber,
  Segmented,
  Skeleton,
  Space,
  Typography,
  message
} from 'antd'
import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/api'
import { useAppSettings } from '@renderer/settings-context'

function SettingsPage(): React.JSX.Element {
  const [form] = Form.useForm<AppSettings>()
  const { state, loading, save } = useAppSettings()
  const [saving, setSaving] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => form.setFieldsValue(state.settings), [form, state.settings])

  const handleSave = (settings: AppSettings): void => {
    setSaving(true)
    void save(settings)
      .then(() => messageApi.success('设置已保存并生效'))
      .catch((error: unknown) =>
        messageApi.error(error instanceof Error ? error.message : '设置保存失败')
      )
      .finally(() => setSaving(false))
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {contextHolder}
      <div className="mb-6">
        <Typography.Title level={2}>设置</Typography.Title>
        <Typography.Paragraph type="secondary">
          管理本机 Agent 连接和 Loci 的显示方式。
        </Typography.Paragraph>
      </div>

      {loading ? (
        <Card variant="borderless">
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : (
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Space direction="vertical" size="middle" className="w-full">
            <Card
              title={
                <Space>
                  <CloudServerOutlined /> Agent 连接
                </Space>
              }
              extra={
                state.mcp.running ? (
                  <Typography.Text type="success">
                    <CheckCircleOutlined /> 运行中
                  </Typography.Text>
                ) : undefined
              }
            >
              <Typography.Paragraph type="secondary">
                MCP 服务只监听本机回环地址。保存新端口后，Agent 连接地址立即切换。
              </Typography.Paragraph>
              {state.mcp.error && (
                <Alert className="mb-4" type="error" showIcon message={state.mcp.error} />
              )}
              <Form.Item
                name="mcpPort"
                label="MCP 端口"
                rules={[
                  { required: true, message: '请输入端口号' },
                  {
                    type: 'number',
                    min: 1024,
                    max: 65535,
                    message: '请输入 1024 到 65535 之间的端口'
                  }
                ]}
              >
                <InputNumber className="w-full" min={1024} max={65535} addonBefore="127.0.0.1" />
              </Form.Item>
              <Typography.Text type="secondary">当前地址</Typography.Text>
              <Typography.Paragraph copyable={{ text: state.mcp.endpoint }} className="mb-0! mt-1!">
                <Typography.Text code>{state.mcp.endpoint}</Typography.Text>
              </Typography.Paragraph>
            </Card>

            <Card
              title={
                <Space>
                  <DashboardOutlined /> 抓取默认值
                </Space>
              }
            >
              <Typography.Paragraph type="secondary">
                文档源没有单独设置并发时，按实际抓取方式使用这里的值。
              </Typography.Paragraph>
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <Form.Item
                  name="httpConcurrency"
                  label="HTTP 并发"
                  rules={[{ required: true, type: 'number', min: 1, max: 32 }]}
                >
                  <InputNumber min={1} max={32} className="w-full" addonAfter="页" />
                </Form.Item>
                <Form.Item
                  name="browserConcurrency"
                  label="浏览器并发"
                  rules={[{ required: true, type: 'number', min: 1, max: 32 }]}
                >
                  <InputNumber min={1} max={32} className="w-full" addonAfter="页" />
                </Form.Item>
              </div>
            </Card>

            <Card
              title={
                <Space>
                  <BgColorsOutlined /> 外观
                </Space>
              }
            >
              <Form.Item name="theme" label="主题" className="mb-0!">
                <Segmented
                  block
                  options={[
                    { value: 'auto', label: '跟随系统', icon: <DesktopOutlined /> },
                    { value: 'light', label: '浅色', icon: <BulbOutlined /> },
                    { value: 'dark', label: '深色', icon: <MoonOutlined /> }
                  ]}
                />
              </Form.Item>
            </Card>

            <div className="flex justify-end pt-2">
              <Button type="primary" htmlType="submit" loading={saving}>
                保存设置
              </Button>
            </div>
          </Space>
        </Form>
      )}
    </div>
  )
}

export default SettingsPage
