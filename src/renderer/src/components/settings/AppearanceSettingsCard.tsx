import { BgColorsOutlined, BulbOutlined, DesktopOutlined, MoonOutlined } from '@ant-design/icons'
import { Button, Card, Form, Segmented, Space, Typography } from 'antd'
import { useEffect } from 'react'
import type { ThemeMode } from '@shared/api'

interface AppearanceSettingsCardProps {
  theme: ThemeMode
  saving: boolean
  onSave: (theme: ThemeMode) => void
}

/**
 * 主题外观设置卡片
 */
export function AppearanceSettingsCard({
  theme,
  saving,
  onSave
}: AppearanceSettingsCardProps): React.JSX.Element {
  const [form] = Form.useForm<{ theme: ThemeMode }>()

  useEffect(() => {
    form.setFieldsValue({ theme })
  }, [form, theme])

  return (
    <Card
      className="border border-solid border-[var(--ant-color-border-secondary)] rounded-xl"
      title={
        <Space>
          <BgColorsOutlined className="text-primary" />
          <span>主题外观</span>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ theme }}
        onFinish={(values) => onSave(values.theme)}
      >
        <Typography.Paragraph type="secondary" className="text-xs mb-4">
          选择符合你偏好的显示模式。开启跟随系统后，界面颜色将随操作系统的颜色模式动态调整。
        </Typography.Paragraph>

        <Form.Item name="theme" className="mb-4">
          <Segmented
            block
            size="large"
            options={[
              { value: 'auto', label: '跟随系统', icon: <DesktopOutlined /> },
              { value: 'light', label: '浅色模式', icon: <BulbOutlined /> },
              { value: 'dark', label: '深色模式', icon: <MoonOutlined /> }
            ]}
          />
        </Form.Item>

        <div className="flex justify-end">
          <Button type="primary" htmlType="submit" loading={saving}>
            保存外观设置
          </Button>
        </div>
      </Form>
    </Card>
  )
}
